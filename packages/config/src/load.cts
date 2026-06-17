import type {
  LoadedWorkflowConfig,
  LoadWorkflowConfigOptions,
} from './load.js';

export async function loadWorkflowConfig(
  options: LoadWorkflowConfigOptions
): Promise<LoadedWorkflowConfig> {
  const loader = await import('./load.js');
  return loader.loadWorkflowConfig(options);
}
