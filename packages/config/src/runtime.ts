import type { WorkflowConfig } from './schema.js';

const RuntimeWorkflowConfig = Symbol.for('@workflow/config/runtime');

const globals = globalThis as typeof globalThis & {
  [RuntimeWorkflowConfig]?: WorkflowConfig;
};

export function getRuntimeWorkflowConfig(): WorkflowConfig | undefined {
  return globals[RuntimeWorkflowConfig];
}

export function setRuntimeWorkflowConfig(
  config: WorkflowConfig | undefined
): void {
  globals[RuntimeWorkflowConfig] = config;
}
