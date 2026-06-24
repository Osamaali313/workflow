import type { LoadedWorkflowConfig } from './workflow-config.js';

export async function loadWorkflowConfig(options: {
  cwd: string;
  configFile?: string;
}): Promise<LoadedWorkflowConfig> {
  const loader = await import('./workflow-config.js');
  return loader.loadWorkflowConfig(options);
}
