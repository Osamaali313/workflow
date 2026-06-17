import { resolve } from 'node:path';
import { loadWorkflowConfig } from '@workflow/config/load';
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

export const getWorkflowConfig = async (
  options: {
    buildTarget?: BuildTarget;
    workflowManifest?: string;
    configFile?: string;
  } = {}
): Promise<WorkflowConfig> => {
  const { buildTarget = 'standalone', workflowManifest, configFile } = options;
  const workingDir = resolveWorkflowCwd();
  loadDotEnv({
    path: resolve(workingDir, '.env.local'),
    quiet: true,
  });
  loadDotEnv({
    path: resolve(workingDir, '.env'),
    quiet: true,
  });

  const loadedConfig = await loadWorkflowConfig({
    cwd: workingDir,
    configFile,
  });
  const fileConfig = loadedConfig.config;
  const config: WorkflowConfig = {
    dirs: fileConfig.build?.dirs ?? ['./workflows'],
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
