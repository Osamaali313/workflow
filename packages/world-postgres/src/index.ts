import type {
  ProviderValue,
  Storage,
  World,
  WorldProvider,
} from '@workflow/world';
import {
  defineWorldProvider,
  reenqueueActiveRuns,
  resolveProviderValue,
  SPEC_VERSION_CURRENT,
} from '@workflow/world';
import { Pool } from 'pg';
import type { PostgresWorldConfig } from './config.js';
import { createClient, type Drizzle } from './drizzle/index.js';
import { createQueue } from './queue.js';
import {
  createEventsStorage,
  createHooksStorage,
  createRunsStorage,
  createStepsStorage,
} from './storage.js';
import { createStreamer } from './streamer.js';

function createStorage(drizzle: Drizzle): Storage {
  return {
    runs: createRunsStorage(drizzle),
    events: createEventsStorage(drizzle),
    hooks: createHooksStorage(drizzle),
    steps: createStepsStorage(drizzle),
  };
}

function getDefaultMaxPoolSize(): number | undefined {
  const parsed = parseInt(
    process.env.WORKFLOW_POSTGRES_MAX_POOL_SIZE || '',
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getQueueConcurrencyFromEnv(): number | undefined {
  const parsed = parseInt(
    process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY || '',
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getDefaultQueueConcurrency(): number {
  return getQueueConcurrencyFromEnv() ?? 50;
}

export function createWorld(
  config: PostgresWorldConfig = {
    connectionString:
      process.env.WORKFLOW_POSTGRES_URL ||
      'postgres://world:world@localhost:5432/world',
  }
): World & { start(): Promise<void> } {
  const resolvedConfig = {
    ...config,
    jobPrefix: config.jobPrefix ?? process.env.WORKFLOW_POSTGRES_JOB_PREFIX,
    queueConcurrency: config.queueConcurrency ?? getDefaultQueueConcurrency(),
  };
  const maxPoolSize = resolvedConfig.maxPoolSize ?? getDefaultMaxPoolSize();
  const pool =
    resolvedConfig.pool ||
    new Pool({
      connectionString:
        resolvedConfig.connectionString ||
        'postgres://world:world@localhost:5432/world',
      ...(maxPoolSize !== undefined ? { max: maxPoolSize } : {}),
    });

  const drizzle = createClient(pool);
  const queue = createQueue(resolvedConfig, pool);
  const storage = createStorage(drizzle);
  const streamer = createStreamer(pool, drizzle);

  return {
    specVersion: SPEC_VERSION_CURRENT,
    ...storage,
    ...streamer,
    ...queue,
    ...(resolvedConfig.streamFlushIntervalMs !== undefined && {
      streamFlushIntervalMs: resolvedConfig.streamFlushIntervalMs,
    }),
    async start() {
      await queue.start();
      await reenqueueActiveRuns(storage.runs, queue.queue, 'world-postgres');
    },
    async close() {
      await streamer.close();
      await queue.close();
      if (pool !== resolvedConfig.pool) {
        await pool.end();
      }
    },
  };
}

export type PostgresWorldProviderConfig = Omit<
  Extract<PostgresWorldConfig, { connectionString: string }>,
  'connectionString' | 'namespace' | 'pool'
> & {
  connectionString?: ProviderValue<string>;
};

/** Creates a PostgreSQL provider for workflow.config.ts. */
export function postgresWorld(
  config: PostgresWorldProviderConfig = {}
): WorldProvider {
  return defineWorldProvider({
    id: '@workflow/world-postgres',
    create: () =>
      createWorld({
        connectionString:
          process.env.WORKFLOW_POSTGRES_URL ||
          (config.connectionString === undefined
            ? 'postgres://world:world@localhost:5432/world'
            : resolveProviderValue(config.connectionString)),
        jobPrefix: process.env.WORKFLOW_POSTGRES_JOB_PREFIX ?? config.jobPrefix,
        queueConcurrency:
          getQueueConcurrencyFromEnv() ?? config.queueConcurrency,
        maxPoolSize: getDefaultMaxPoolSize() ?? config.maxPoolSize,
        streamFlushIntervalMs: config.streamFlushIntervalMs,
      }),
  });
}

// Re-export schema for users who want to extend or inspect the database schema
export type { PostgresWorldConfig } from './config.js';
export * from './drizzle/schema.js';
