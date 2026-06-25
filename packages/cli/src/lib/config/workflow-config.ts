import { resolve } from 'node:path';
import {
  type LoadedWorkflowConfig,
  loadWorkflowConfig,
} from '@workflow/builders/workflow-config';
import { config as loadDotEnv } from 'dotenv';
import type { BuildTarget, WorkflowConfig } from './types.js';

type CliBuildTarget = Extract<
  BuildTarget,
  'standalone' | 'vercel-build-output-api'
>;

export function resolveWorkflowCwd(): string {
  const raw = process.env.WORKFLOW_OBSERVABILITY_CWD;
  if (!raw) return process.cwd();
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

export const getWorkflowConfig = async (options: {
  buildTarget: CliBuildTarget;
  workflowManifest?: string;
  configFile?: string;
}): Promise<WorkflowConfig> => {
  const { buildTarget, workflowManifest, configFile } = options;
  const workingDir = resolveWorkflowCwd();
  const loadedConfig = await loadProjectWorkflowConfig(configFile);
  const fileConfig = loadedConfig.config;
  const config = {
    dirs:
      fileConfig.build?.dirs ??
      (buildTarget === 'standalone' ? ['.'] : ['./workflows']),
    workingDir,
    projectRoot: fileConfig.build?.projectRoot,
    worldModule: loadedConfig.worldModule,
    runtimeConfig: fileConfig.runtime,
    sourcemap: process.env.WORKFLOW_SOURCEMAP
      ? undefined
      : fileConfig.build?.sourcemap,
    workflowManifestPath: workflowManifest,
  };
  if (buildTarget === 'standalone') {
    return {
      ...config,
      buildTarget,
      stepsBundlePath: './.well-known/workflow/v1/step.mjs',
      workflowsBundlePath: './.well-known/workflow/v1/flow.mjs',
      webhookBundlePath: './.well-known/workflow/v1/webhook.mjs',
    };
  }

  return { ...config, buildTarget };
};
