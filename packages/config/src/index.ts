export {
  defineWorldProvider,
  type ProviderValue,
  type WorldProvider,
} from '@workflow/world';
export type { WorkflowConfigLoader } from './load.js';
export type { SourcemapMode, WorkflowConfig } from './schema.js';
export { WorkflowConfigSchema } from './schema.js';

import type { WorkflowConfig } from './schema.js';

export function defineConfig(config: WorkflowConfig): WorkflowConfig {
  return config;
}
