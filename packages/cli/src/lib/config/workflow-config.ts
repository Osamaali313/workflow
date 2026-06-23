import { resolve } from 'node:path';
import {
  type LoadedWorkflowConfig,
  loadWorkflowConfig,
} from '@workflow/config/load';
import { config as loadDotEnv } from 'dotenv';
import type { BuildTarget, WorkflowConfig } from './types.js';

export function resolveWorkflowCwd(): string {
  const raw = process.env.WORKFLOW_OBSERVABILITY_CWD;
  if (!raw) {
    return process.cwd();
  }
  // Allow relative paths; resolve relative to the current process.cwd()
  // (i.e. where the CLI was invoked).
  return resolve(process.cwd(), raw);
}

export async function loadProjectWorkflowConfig(
  configFile?: string
): Promise<LoadedWorkflowConfig> {
  const cwd = resolveWorkflowCwd();
  loadDotEnv({ path: resolve(cwd, '.env.local'), quiet: true });
  loadDotEnv({ path: resolve(cwd, '.env'), quiet: true });
  return loadWorkflowConfig({ cwd, configFile });
}

export const getWorkflowConfig = async (
  options: {
    buildTarget?: BuildTarget;
    workflowManifest?: string;
    configFile?: string;
  } = {}
): Promise<WorkflowConfig> => {
  const { buildTarget = 'standalone', workflowManifest, configFile } = options;
  const workingDir = resolveWorkflowCwd();
  const loadedConfig = await loadProjectWorkflowConfig(configFile);
  const fileConfig = loadedConfig.config;
  const config: WorkflowConfig = {
    dirs:
      fileConfig.build?.dirs ??
      (buildTarget === 'standalone' ? ['.'] : ['./workflows']),
    workingDir,
    projectRoot: fileConfig.build?.projectRoot
      ? resolve(workingDir, fileConfig.build.projectRoot)
      : undefined,
    externalPackages: fileConfig.build?.externalPackages,
    workflowConfig: loadedConfig,
    buildTarget,
    stepsBundlePath: './.well-known/workflow/v1/step.mjs',
    workflowsBundlePath: './.well-known/workflow/v1/flow.mjs',
    webhookBundlePath: './.well-known/workflow/v1/webhook.mjs',
    workflowManifestPath: workflowManifest,

    // WIP: generate a client library to easily execute workflows/steps
    // clientBundlePath: './lib/generated/workflows.js',
  };
  return config;
};
