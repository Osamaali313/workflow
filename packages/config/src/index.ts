export type { SourcemapMode, WorkflowConfig } from './schema.js';
export type WorkflowConfigLoader =
  typeof import('./load.js').loadWorkflowConfig;

import type { WorkflowConfig } from './schema.js';

export function defineConfig(config: WorkflowConfig): WorkflowConfig {
  return config;
}
