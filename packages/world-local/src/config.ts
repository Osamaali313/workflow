import { getWorkflowPort } from '@workflow/utils/get-port';

export const DEFAULT_RESOLVE_DATA_OPTION = 'all';

export type LocalWorldConfig = {
  /** Filesystem directory for workflow state. Defaults to `.workflow-data`. */
  dataDir?: string;
  /** Local server port. Ignored when `baseUrl` is set. */
  port?: number;
  /** Full queue and API base URL. */
  baseUrl?: string;
  /** Maximum concurrent queue workers. Defaults to `1000`. */
  queueConcurrency?: number;
  /** Maximum queue visibility timeout in seconds. Defaults to unlimited. */
  maxQueueVisibilitySeconds?: number;
  /**
   * Whether start() should re-enqueue pending/running runs from storage.
   * Defaults to true. Test harnesses that always start from a clean slate can
   * disable recovery to avoid replaying stale runs.
   */
  recoverActiveRuns?: boolean;
  /**
   * Optional tag to scope filesystem operations.
   * When set, files are written as `{id}.{tag}.json` and `clear()` only deletes
   * files matching this tag. Used by vitest to isolate test data in the shared
   * `.workflow-data` directory.
   */
  tag?: string;
  /**
   * Override the flush interval (in ms) for buffered stream writes.
   * Default is 10ms. Set to 0 for immediate flushing.
   */
  streamFlushIntervalMs?: number;
};

/**
 * Resolves the base URL for queue requests following the priority order:
 * 1. config.baseUrl
 * 2. config.port
 * 3. WORKFLOW_LOCAL_BASE_URL
 * 4. PORT env var (explicit configuration)
 * 5. Auto-detected port via getPort (detect actual listening port)
 */
export async function resolveBaseUrl(
  config: LocalWorldConfig
): Promise<string> {
  if (config.baseUrl) {
    return config.baseUrl;
  }

  if (typeof config.port === 'number') {
    return `http://localhost:${config.port}`;
  }

  if (process.env.WORKFLOW_LOCAL_BASE_URL) {
    return process.env.WORKFLOW_LOCAL_BASE_URL;
  }

  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }

  const detectedPort = await getWorkflowPort();
  if (detectedPort) {
    return `http://localhost:${detectedPort}`;
  }

  throw new Error('Unable to resolve base URL for workflow queue.');
}
