import type { Storage, World } from '@workflow/world';
import {
  getQueueTopicPrefix,
  reenqueueActiveRuns,
  resolveQueueNamespace,
  SPEC_VERSION_CURRENT,
} from '@workflow/world';
import { setWorkflowQueueNamespace } from '@workflow/world/queue.js';
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

export function createWorld(
  config: PostgresWorldConfig = {
    connectionString:
      process.env.WORKFLOW_POSTGRES_URL ||
      'postgres://world:world@localhost:5432/world',
    jobPrefix: process.env.WORKFLOW_POSTGRES_JOB_PREFIX,
    queueConcurrency:
      parseInt(process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY || '50', 10) ||
      50,
  }
): World & { start(): Promise<void> } {
  let usesProviderNamespace = false;
  const maxPoolSize = config.maxPoolSize ?? getDefaultMaxPoolSize();
  const pool =
    config.pool ||
    new Pool({
      connectionString:
        config.connectionString ||
        'postgres://world:world@localhost:5432/world',
      ...(maxPoolSize !== undefined ? { max: maxPoolSize } : {}),
    });

  const drizzle = createClient(pool);
  const queue = createQueue(config, pool);
  const storage = createStorage(drizzle);
  const streamer = createStreamer(pool, drizzle);

  return {
    specVersion: SPEC_VERSION_CURRENT,
    ...storage,
    ...streamer,
    ...queue,
    ...(config.streamFlushIntervalMs !== undefined && {
      streamFlushIntervalMs: config.streamFlushIntervalMs,
    }),
    async start() {
      if (resolveQueueNamespace() === undefined && config.namespace) {
        setWorkflowQueueNamespace(config.namespace);
        usesProviderNamespace = true;
      }
      await queue.start();
      await reenqueueActiveRuns(
        storage.runs,
        queue.queue,
        getQueueTopicPrefix('workflow', resolveQueueNamespace())
      );
    },
    async close() {
      await streamer.close();
      await queue.close();
      if (pool !== config.pool) {
        await pool.end();
      }
      if (usesProviderNamespace) {
        setWorkflowQueueNamespace(undefined);
      }
    },
  };
}

// Re-export schema for users who want to extend or inspect the database schema
export type { PostgresWorldConfig } from './config.js';
export * from './drizzle/schema.js';
