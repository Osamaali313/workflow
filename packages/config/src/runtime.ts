import type { RuntimeWorkflowConfig } from './runtime-binding.js';

const RuntimeWorkflowConfigSymbol = Symbol.for('@workflow/config/runtime');

const globals = globalThis as typeof globalThis & {
  [RuntimeWorkflowConfigSymbol]?: RuntimeWorkflowConfig;
};

export function getRuntimeWorkflowConfig(): RuntimeWorkflowConfig | undefined {
  return globals[RuntimeWorkflowConfigSymbol];
}

export function setRuntimeWorkflowConfig(
  config: RuntimeWorkflowConfig | undefined
): void {
  globals[RuntimeWorkflowConfigSymbol] = config;
}
