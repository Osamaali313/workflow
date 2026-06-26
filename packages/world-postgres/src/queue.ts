import * as Stream from 'node:stream';
import type { Transport } from '@vercel/queue';
import { getWorkflowPort } from '@workflow/utils/get-port';
import {
  getQueuePrefixKind,
  getQueueTopicPrefix,
  MessageId,
  parseQueueName,
  type Queue,
  type QueueKind,
  type QueuePayload,
  QueuePayloadSchema,
  type QueuePrefix,
  resolveQueueNamespace,
  ValidQueueName,
} from '@workflow/world';
import {
  Logger,
  makeWorkerUtils,
  type Runner,
  run,
  type WorkerUtils,
} from 'graphile-worker';
import type { Pool } from 'pg';
import { monotonicFactory } from 'ulid';
import { z } from 'zod/v4';
import type { PostgresWorldConfig } from './config.js';
import { MessageData } from './message.js';

function createGraphileLogger() {
  const isJsonMode = () => process.env.WORKFLOW_JSON_MODE === '1';
  const isVerbose = () => Boolean(process.env.DEBUG);

  return new Logger(() => (level: string, message: string, meta?: unknown) => {
    if (isJsonMode()) return;
    if ((level === 'debug' || level === 'info') && !isVerbose()) return;
    const pipe = level === 'error' ? process.stderr : process.stdout;
    if (meta) {
      pipe.write(
        `[Graphile Worker] ${message} ${JSON.stringify(meta, null, 2)}\n`
      );
    } else {
      pipe.write(`[Graphile Worker] ${message}\n`);
    }
  });
}

const graphileLogger = createGraphileLogger();
const COMPLETED_IDEMPOTENCY_CACHE_LIMIT = 10_000;
const REGISTRATION_RETRY_MS = 500;
const REGISTRATION_PROBE_TIMEOUT_MS = 500;
const FLOW_HEALTH_PATH = '/.well-known/workflow/v1/flow?__health';
const STEP_HEALTH_PATH = '/.well-known/workflow/v1/step?__health';
const GraphileHelpers = z.object({
  job: z.object({
    attempts: z.number().int().positive(),
  }),
});
const QueueHandlerHttpResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ timeoutSeconds: z.number() }),
]);

const HeaderParser = z.object({
  'x-vqs-queue-name': ValidQueueName,
  'x-vqs-message-id': MessageId,
  'x-vqs-message-attempt': z.coerce.number().int().positive(),
});

type QueueHandler = Parameters<Queue['createQueueHandler']>[1];
type QueueHandlerResult = Awaited<ReturnType<QueueHandler>>;
type QueueHandlerHttpResponse = z.infer<typeof QueueHandlerHttpResponseSchema>;

type QueueExecutionResult =
  | { type: 'completed' }
  | { type: 'reschedule'; timeoutSeconds: number };

type QueueTaskExecutor = { type: 'direct' } | { type: 'http'; baseUrl: string };
type RunnerTarget = {
  queuePrefixes: QueuePrefix[];
  executor: QueueTaskExecutor;
};
type HealthyWorkflowRoutes = {
  baseUrl: string;
  step: boolean;
};

const globalQueueState = globalThis as typeof globalThis & {
  __workflowPostgresQueueHandlers?: Map<QueuePrefix, QueueHandler>;
  __workflowPostgresQueueStarters?: Set<() => void>;
};
if (!globalQueueState.__workflowPostgresQueueHandlers) {
  globalQueueState.__workflowPostgresQueueHandlers = new Map();
}
if (!globalQueueState.__workflowPostgresQueueStarters) {
  globalQueueState.__workflowPostgresQueueStarters = new Set();
}
const registeredHandlers = globalQueueState.__workflowPostgresQueueHandlers;
const queueStarters = globalQueueState.__workflowPostgresQueueStarters;

/**
 * The Postgres queue works by creating two job types in graphile-worker:
 * - `workflow` for workflow jobs
 *   - `step` for step jobs
 *
 * When a message is queued, it is sent to graphile-worker with the appropriate job type.
 * When a job is processed, Graphile executes the registered workflow handler
 * directly in this process and only acknowledges the job after execution
 * completes or a durable delayed follow-up job is scheduled.
 */
export type PostgresQueue = Queue & {
  start(): Promise<void>;
  close(): Promise<void>;
};

export function createQueue(
  config: PostgresWorldConfig,
  pool: Pool
): PostgresQueue {
  // JSON transport that preserves Uint8Array values via a tagged
  // envelope ({ __type: 'Uint8Array', data: '<base64>' }).  Required
  // for the resilient start path where runInput.input (a Uint8Array)
  // is sent through the queue.
  const transport: Transport<unknown> = {
    contentType: 'application/json',
    serialize(value: unknown): Buffer {
      return Buffer.from(
        JSON.stringify(value, (_key, v) =>
          v instanceof Uint8Array
            ? { __type: 'Uint8Array', data: Buffer.from(v).toString('base64') }
            : v
        )
      );
    },
    async deserialize(stream: ReadableStream<Uint8Array>): Promise<unknown> {
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString(), (_key, v) =>
        v !== null &&
        typeof v === 'object' &&
        v.__type === 'Uint8Array' &&
        typeof v.data === 'string'
          ? new Uint8Array(Buffer.from(v.data, 'base64'))
          : v
      );
    },
  };
  const generateMessageId = monotonicFactory();
  const namespace = resolveQueueNamespace(config.namespace);
  const workflowPrefix = getQueueTopicPrefix('workflow', namespace);
  const stepPrefix = getQueueTopicPrefix('step', namespace);
  const requiredQueuePrefixes = [workflowPrefix] as QueuePrefix[];
  const expectedQueuePrefixes = [workflowPrefix, stepPrefix] as QueuePrefix[];

  function getJobQueueName(queuePrefix: QueuePrefix): string {
    const jobPrefix = config.jobPrefix || 'workflow_';

    return getQueuePrefixKind(queuePrefix) === 'workflow'
      ? `${jobPrefix}flows`
      : `${jobPrefix}steps`;
  }

  const getDeploymentId: Queue['getDeploymentId'] = async () => {
    return 'postgres';
  };

  const ownedHandlers = new Map<QueuePrefix, QueueHandler>();
  const completedMessages = new Set<string>();
  const inflightMessages = new Map<string, Promise<void>>();
  const inflightWorkflowRuns = new Map<string, Promise<QueueExecutionResult>>();
  let workerUtils: WorkerUtils | null = null;
  let runner: Runner | null = null;
  let runningTarget: RunnerTarget | null = null;
  let httpRunnerTarget: RunnerTarget | null = null;
  let startPromise: Promise<void> | null = null;
  let runnerPromise: Promise<void> | null = null;
  let startRunnerTail: Promise<void> = Promise.resolve();
  let registrationPromise: Promise<void> | null = null;
  let resolveRegistrationRetry: (() => void) | null = null;
  let closed = false;
  const requestRunnerStart = () => {
    void startRunner().catch(logStartRunnerError);
  };
  queueStarters.add(requestRunnerStart);

  function logStartRunnerError(err: unknown) {
    process.stderr.write(
      `[Graphile Worker] Failed to start after handler registration: ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`
    );
  }

  function markMessageCompleted(idempotencyKey: string) {
    completedMessages.delete(idempotencyKey);
    completedMessages.add(idempotencyKey);
    if (completedMessages.size > COMPLETED_IDEMPOTENCY_CACHE_LIMIT) {
      const oldestKey = completedMessages.values().next().value;
      if (oldestKey) {
        completedMessages.delete(oldestKey);
      }
    }
  }

  async function addGraphileJob({
    queuePrefix,
    queueId,
    body,
    messageId,
    attempt,
    idempotencyKey,
    headers,
    delaySeconds,
    jobKey,
  }: {
    queuePrefix: QueuePrefix;
    queueId: string;
    body: Buffer | Uint8Array;
    messageId: MessageId;
    attempt: number;
    idempotencyKey?: string;
    headers?: Record<string, string>;
    delaySeconds?: number;
    jobKey?: string;
  }) {
    const utils = workerUtils;
    if (!utils) {
      throw new Error('Postgres queue worker utils are not initialized');
    }

    const runAt =
      typeof delaySeconds === 'number' && delaySeconds > 0
        ? new Date(Date.now() + delaySeconds * 1000)
        : undefined;

    await utils.addJob(
      getJobQueueName(queuePrefix),
      MessageData.encode({
        id: queueId,
        data: Buffer.from(body),
        attempt,
        messageId,
        idempotencyKey,
        headers,
      }),
      {
        ...(jobKey ? { jobKey } : {}),
        ...(runAt ? { runAt } : {}),
        maxAttempts: 3,
      }
    );
  }

  function queueExecutionResult(
    result: QueueHandlerResult | QueueHandlerHttpResponse
  ): QueueExecutionResult {
    if (result === undefined) {
      return { type: 'completed' };
    }
    if ('timeoutSeconds' in result) {
      return { type: 'reschedule', timeoutSeconds: result.timeoutSeconds };
    }
    return { type: 'completed' };
  }

  async function executeMessageDirect({
    queueName,
    messageId,
    attempt,
    message,
    headers: extraHeaders,
  }: {
    queueName: ValidQueueName;
    messageId: MessageId;
    attempt: number;
    message: QueuePayload;
    headers?: Record<string, string>;
  }): Promise<QueueExecutionResult> {
    const { prefix } = parseQueueName(queueName);
    const handler = registeredHandlers.get(prefix);
    if (!handler) {
      throw new Error(`No handler registered for queue prefix ${prefix}`);
    }

    const result = await handler(message, {
      attempt,
      queueName,
      messageId,
      requestId: extraHeaders?.['x-vercel-id'],
    });

    return queueExecutionResult(result);
  }

  async function executeMessageOverHttp({
    executor,
    queueName,
    messageId,
    attempt,
    body,
    headers: extraHeaders,
  }: {
    executor: Extract<QueueTaskExecutor, { type: 'http' }>;
    queueName: ValidQueueName;
    messageId: MessageId;
    attempt: number;
    body: Uint8Array;
    headers?: Record<string, string>;
  }): Promise<QueueExecutionResult> {
    const headers: Record<string, string> = {
      ...extraHeaders,
      'content-type': 'application/json',
      'x-vqs-queue-name': queueName,
      'x-vqs-message-id': messageId,
      'x-vqs-message-attempt': String(attempt),
    };
    const pathname =
      parseQueueName(queueName).kind === 'workflow' ? 'flow' : 'step';
    const response = await fetch(
      `${executor.baseUrl}/.well-known/workflow/v1/${pathname}`,
      {
        method: 'POST',
        duplex: 'half',
        headers,
        body,
      } as RequestInit
    );
    if (!response.ok) {
      throw new Error(
        `Workflow queue HTTP execution failed with status ${response.status}: ${await response.text()}`
      );
    }
    return queueExecutionResult(
      QueueHandlerHttpResponseSchema.parse(await response.json())
    );
  }

  async function deserializeMessage(body: Uint8Array): Promise<QueuePayload> {
    const bodyStream = Stream.Readable.toWeb(Stream.Readable.from([body]));
    return QueuePayloadSchema.parse(
      await transport.deserialize(bodyStream as ReadableStream<Uint8Array>)
    );
  }

  function getWorkflowRunSerializationKey(
    queueKind: QueueKind,
    message: QueuePayload
  ): string | undefined {
    if (queueKind !== 'workflow') return undefined;
    return 'runId' in message ? `workflow:${message.runId}` : undefined;
  }

  function getGraphileAttempt(helpers: unknown, fallback: number): number {
    const graphileAttempt = GraphileHelpers.safeParse(helpers);
    return graphileAttempt.success
      ? graphileAttempt.data.job.attempts
      : fallback;
  }

  function queueHandlerResponse(result: QueueHandlerResult): Response {
    if (typeof result?.timeoutSeconds === 'number') {
      return Response.json({ timeoutSeconds: result.timeoutSeconds });
    }
    return Response.json({ ok: true });
  }

  async function runSerializedWorkflowTask(
    serializationKey: string,
    executeTask: () => Promise<QueueExecutionResult>
  ) {
    const previous = inflightWorkflowRuns.get(serializationKey);
    const execution = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(() => executeTask())
      .finally(() => {
        if (inflightWorkflowRuns.get(serializationKey) === execution) {
          inflightWorkflowRuns.delete(serializationKey);
        }
      });
    inflightWorkflowRuns.set(serializationKey, execution);
    await execution;
  }

  async function migratePgBossJobs(utils: WorkerUtils): Promise<void> {
    // Scenario A: Drizzle migration already ran — staging table exists
    const hasStaging = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'workflow'
        AND table_name = '_pgboss_pending_jobs'
      ) AS exists`
    );
    if (hasStaging.rows[0]?.exists) {
      const jobs = await pool.query(
        `SELECT name, data, singleton_key, retry_limit
        FROM "workflow"."_pgboss_pending_jobs"`
      );
      for (const job of jobs.rows) {
        await utils.addJob(job.name, job.data as Record<string, unknown>, {
          jobKey: job.singleton_key ?? undefined,
          maxAttempts: job.retry_limit ?? 3,
        });
      }
      await pool.query(`DROP TABLE "workflow"."_pgboss_pending_jobs"`);
      return;
    }

    // Scenario B: Drizzle migration didn't run — pgboss schema still exists
    const hasPgBoss = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = 'pgboss'
      ) AS exists`
    );
    if (hasPgBoss.rows[0]?.exists) {
      const jobs = await pool.query(
        `SELECT name, data, singleton_key, retry_limit
        FROM pgboss.job
        WHERE state IN ('created', 'retry')`
      );
      for (const job of jobs.rows) {
        await utils.addJob(job.name, job.data as Record<string, unknown>, {
          jobKey: job.singleton_key ?? undefined,
          maxAttempts: job.retry_limit ?? 3,
        });
      }
      await pool.query(`DROP SCHEMA pgboss CASCADE`);
    }
  }

  async function startWorkerUtils(): Promise<void> {
    closed = false;
    if (!startPromise) {
      startPromise = (async () => {
        try {
          const utils = await makeWorkerUtils({
            pgPool: pool,
            logger: graphileLogger,
          });
          await utils.migrate();
          await migratePgBossJobs(utils);
          workerUtils = utils;
        } catch (err) {
          startPromise = null;
          throw err;
        }
      })();
    }
    await startPromise;
  }

  async function start(): Promise<void> {
    await startWorkerUtils();
    await startRunner();
  }

  const queue: Queue['queue'] = async (queue, message, opts) => {
    await startWorkerUtils();
    if (!runner && !runnerPromise) {
      await startRunner();
    }
    const { prefix: queuePrefix, id: queueId } = parseQueueName(queue);
    const body = transport.serialize(message) as Buffer;
    const messageId = MessageId.parse(`msg_${generateMessageId()}`);
    await addGraphileJob({
      queuePrefix,
      queueId,
      body,
      messageId,
      attempt: 1,
      idempotencyKey: opts?.idempotencyKey,
      headers: opts?.headers,
      delaySeconds: opts?.delaySeconds,
      jobKey: opts?.idempotencyKey ?? messageId,
    });
    return { messageId };
  };

  function createTaskHandler(queue: QueuePrefix, executor: QueueTaskExecutor) {
    const queueKind = getQueuePrefixKind(queue);

    return async (payload: unknown, helpers: unknown) => {
      const messageData = MessageData.parse(payload);
      const attempt = getGraphileAttempt(helpers, messageData.attempt);
      const queueName = `${queue}${messageData.id}` as ValidQueueName;
      const message = await deserializeMessage(messageData.data);
      const workflowRunSerializationKey = getWorkflowRunSerializationKey(
        queueKind,
        message
      );
      const executeTask = async (): Promise<QueueExecutionResult> => {
        const result =
          executor.type === 'direct'
            ? await executeMessageDirect({
                queueName,
                messageId: messageData.messageId,
                attempt,
                message,
                headers: messageData.headers,
              })
            : await executeMessageOverHttp({
                executor,
                queueName,
                messageId: messageData.messageId,
                attempt,
                body: messageData.data,
                headers: messageData.headers,
              });

        switch (result.type) {
          case 'completed':
            return result;
          case 'reschedule':
            // Schedule the follow-up job before we return so a crash cannot
            // lose the wake-up request.
            await addGraphileJob({
              queuePrefix: queue,
              queueId: messageData.id,
              body: messageData.data,
              messageId: messageData.messageId,
              attempt: attempt + 1,
              idempotencyKey: messageData.idempotencyKey,
              headers: messageData.headers,
              delaySeconds: result.timeoutSeconds,
              jobKey: messageData.idempotencyKey ?? messageData.messageId,
            });
            return result;
          default:
            return assertNever(result);
        }
      };

      const idempotencyKey = messageData.idempotencyKey;
      if (!idempotencyKey) {
        if (workflowRunSerializationKey) {
          await runSerializedWorkflowTask(
            workflowRunSerializationKey,
            executeTask
          );
          return;
        }

        await executeTask();
        return;
      }

      if (completedMessages.has(idempotencyKey)) {
        return;
      }

      const existing = inflightMessages.get(idempotencyKey);
      if (existing) {
        await existing;
        return;
      }

      const execution = executeTask()
        .then((result) => {
          if (result.type === 'completed') {
            markMessageCompleted(idempotencyKey);
          }
        })
        .finally(() => {
          inflightMessages.delete(idempotencyKey);
        });
      inflightMessages.set(idempotencyKey, execution);
      await execution;
    };
  }

  async function startRunner(): Promise<void> {
    const run = startRunnerTail.catch(() => {}).then(startRunnerOnce);
    startRunnerTail = run;
    await run;
  }

  async function startRunnerOnce(): Promise<void> {
    if (closed || !workerUtils) return;
    if (runnerPromise) {
      await runnerPromise;
      if (closed) return;
    }

    if (getMissingRequiredQueuePrefixes().length > 0) startRegistrationLoop();
    const target = getRunnerTarget();
    if (!target) {
      await stopRunner();
      return;
    }
    if (runner && hasRunningTarget(target)) return;
    runnerPromise = replaceRunner(target).finally(() => {
      runnerPromise = null;
    });
    await runnerPromise;
  }

  async function replaceRunner({ queuePrefixes, executor }: RunnerTarget) {
    await stopRunner();
    await setupListeners(queuePrefixes, executor);
  }

  async function stopRunner() {
    if (!runner) return;
    await runner.stop();
    runner = null;
    runningTarget = null;
  }

  function hasRunningTarget({ queuePrefixes, executor }: RunnerTarget) {
    const activeTarget = runningTarget;
    if (!activeTarget) return false;
    const sameExecutor =
      activeTarget.executor.type === executor.type &&
      (executor.type === 'direct' ||
        (activeTarget.executor.type === 'http' &&
          activeTarget.executor.baseUrl === executor.baseUrl));
    return (
      sameExecutor &&
      activeTarget.queuePrefixes.length === queuePrefixes.length &&
      queuePrefixes.every((prefix) =>
        activeTarget.queuePrefixes.includes(prefix)
      )
    );
  }

  function startRegistrationLoop() {
    if (registrationPromise) return;
    registrationPromise = waitForHandlerRegistration()
      .catch((err) => {
        process.stderr.write(
          `[Graphile Worker] Failed while waiting for workflow handler registration: ${
            err instanceof Error ? (err.stack ?? err.message) : String(err)
          }\n`
        );
      })
      .finally(() => {
        registrationPromise = null;
      });
  }

  async function waitForHandlerRegistration() {
    while (!closed && needsHandlerRegistration()) {
      const healthyRoutes = await probeWorkflowRoutes();
      if (closed || !needsHandlerRegistration()) break;
      if (healthyRoutes && process.env.WORKFLOW_LOCAL_BASE_URL) {
        httpRunnerTarget = {
          queuePrefixes: getHttpQueuePrefixes(healthyRoutes.step),
          executor: { type: 'http', baseUrl: healthyRoutes.baseUrl },
        };
        if (!healthyRoutes.step) {
          await startRunner();
          await waitForRegistrationRetry();
          continue;
        }
        break;
      }
      await waitForRegistrationRetry();
    }
    await startRunner();
  }

  function needsHandlerRegistration() {
    const target = getRunnerTarget();
    return (
      !target ||
      (target.executor.type === 'http' &&
        target.queuePrefixes.length < expectedQueuePrefixes.length)
    );
  }

  async function waitForRegistrationRetry() {
    await new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout>;
      const wake = () => {
        clearTimeout(timeout);
        if (resolveRegistrationRetry === wake) {
          resolveRegistrationRetry = null;
        }
        resolve();
      };
      resolveRegistrationRetry = wake;
      timeout = setTimeout(wake, REGISTRATION_RETRY_MS);
    });
  }

  async function probeWorkflowRoutes(): Promise<
    HealthyWorkflowRoutes | undefined
  > {
    const baseUrl = await resolveWorkflowBaseUrl();
    if (!baseUrl) return undefined;
    if (!(await probeHealthPath(baseUrl, FLOW_HEALTH_PATH))) return undefined;
    return {
      baseUrl,
      step: await probeHealthPath(baseUrl, STEP_HEALTH_PATH),
    };
  }

  async function probeHealthPath(
    baseUrl: string,
    path: string
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REGISTRATION_PROBE_TIMEOUT_MS
    );
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      // The server may not be listening yet. The registration loop retries.
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolveWorkflowBaseUrl(): Promise<string | undefined> {
    if (process.env.WORKFLOW_LOCAL_BASE_URL) {
      return process.env.WORKFLOW_LOCAL_BASE_URL.replace(/\/$/, '');
    }
    if (process.env.PORT) {
      return `http://localhost:${process.env.PORT}`;
    }
    const port = await getWorkflowPort();
    return typeof port === 'number' ? `http://localhost:${port}` : undefined;
  }

  function getRegisteredQueuePrefixes(): QueuePrefix[] {
    return expectedQueuePrefixes.filter((prefix) =>
      registeredHandlers.has(prefix)
    );
  }

  function getMissingRequiredQueuePrefixes(): QueuePrefix[] {
    return requiredQueuePrefixes.filter(
      (prefix) => !registeredHandlers.has(prefix)
    );
  }

  function getHttpQueuePrefixes(stepRouteHealthy: boolean): QueuePrefix[] {
    return stepRouteHealthy ? expectedQueuePrefixes : requiredQueuePrefixes;
  }

  function getRunnerTarget(): RunnerTarget | undefined {
    const hasRequiredPrefixes = requiredQueuePrefixes.every((prefix) =>
      registeredHandlers.has(prefix)
    );
    const queuePrefixes = getRegisteredQueuePrefixes();
    if (hasRequiredPrefixes) {
      return { queuePrefixes, executor: { type: 'direct' } };
    }
    if (httpRunnerTarget) return httpRunnerTarget;
    return undefined;
  }

  async function setupListeners(
    queuePrefixes: QueuePrefix[],
    executor: QueueTaskExecutor
  ) {
    const taskList: Record<
      string,
      (payload: unknown, helpers: unknown) => Promise<void>
    > = {};
    for (const queuePrefix of queuePrefixes) {
      taskList[getJobQueueName(queuePrefix)] = createTaskHandler(
        queuePrefix,
        executor
      );
    }

    const nextRunner = await run({
      pgPool: pool,
      // Default of 50 is high enough to avoid worker-pool exhaustion in
      // workflows that use parent→child polling patterns (e.g. awaiting a
      // child workflow via `childRun.returnValue` inside the parent).
      // Every such poll holds a worker slot for the duration of the child
      // run. Recursive workflows like `fibonacciWorkflow` fan out quickly
      // — fib(6) produces ~24 concurrent polling steps at peak, and at
      // concurrency=10 (the previous default) it would deadlock on the
      // default Postgres setup. See packages/core/src/runtime/run.ts and
      // docs/content/docs/changelog/eager-processing.mdx for context.
      concurrency: config.queueConcurrency || 50,
      logger: graphileLogger,
      pollInterval: 500, // 500ms = 0.5s (graphile-worker uses LISTEN/NOTIFY when available)
      taskList,
    });
    if (closed) {
      await nextRunner.stop();
      return;
    }
    runner = nextRunner;
    runningTarget = { queuePrefixes, executor };
  }

  const createQueueHandler: Queue['createQueueHandler'] = (prefix, handler) => {
    registeredHandlers.set(prefix, handler);
    ownedHandlers.set(prefix, handler);
    for (const startQueue of queueStarters) {
      startQueue();
    }

    return async (req) => {
      if (!req.body) {
        return Response.json(
          { error: 'Missing request body' },
          { status: 400 }
        );
      }

      const headers = HeaderParser.safeParse(Object.fromEntries(req.headers));
      if (!headers.success) {
        return Response.json(
          { error: 'Missing required headers' },
          { status: 400 }
        );
      }

      const queueName = headers.data['x-vqs-queue-name'];
      if (!queueName.startsWith(prefix)) {
        return Response.json({ error: 'Unhandled queue' }, { status: 400 });
      }

      try {
        const message = await transport.deserialize(req.body);
        const result = await handler(message, {
          attempt: headers.data['x-vqs-message-attempt'],
          queueName,
          messageId: headers.data['x-vqs-message-id'],
          requestId: req.headers.get('x-vercel-id') ?? undefined,
        });

        return queueHandlerResponse(result);
      } catch (error) {
        return Response.json(String(error), { status: 500 });
      }
    };
  };

  return {
    createQueueHandler,
    getDeploymentId,
    queue,
    start,
    async close() {
      closed = true;
      queueStarters.delete(requestRunnerStart);
      resolveRegistrationRetry?.();
      await startPromise?.catch(() => {});
      await registrationPromise?.catch(() => {});
      await startRunnerTail.catch(() => {});
      await runnerPromise?.catch(() => {});
      await stopRunner();
      runningTarget = null;
      if (workerUtils) {
        await workerUtils.release();
        workerUtils = null;
      }
      startPromise = null;
      runnerPromise = null;
      httpRunnerTarget = null;
      for (const [prefix, handler] of ownedHandlers) {
        if (registeredHandlers.get(prefix) === handler) {
          registeredHandlers.delete(prefix);
        }
      }
      ownedHandlers.clear();
      for (const startQueue of queueStarters) {
        startQueue();
      }
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled queue execution result: ${JSON.stringify(value)}`);
}
