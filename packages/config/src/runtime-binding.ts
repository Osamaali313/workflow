import type { WorldProvider } from '@workflow/world';
import type { WorkflowConfig } from './schema.js';

export type RuntimeWorkflowConfig = Pick<WorkflowConfig, 'queue'> & {
  world?: WorldProvider;
};

const config: RuntimeWorkflowConfig | undefined = undefined;

export default config;
