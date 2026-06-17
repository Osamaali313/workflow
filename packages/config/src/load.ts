import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { findUp } from 'find-up';
import { createJiti } from 'jiti';
import {
  type WorkflowConfig,
  WorkflowConfigSchema,
  type WorkflowIntegrationType,
} from './schema.js';

const WORKFLOW_CONFIG_FILES = [
  'workflow.config.ts',
  'workflow.config.mjs',
  'workflow.config.js',
] as const;

export type LoadWorkflowConfigOptions = {
  cwd: string;
  configFile?: string;
  integration?: WorkflowIntegrationType;
};

export type LoadedWorkflowConfig = {
  path: string | undefined;
  config: WorkflowConfig;
};

async function discoverWorkflowConfig({
  cwd,
  configFile,
}: Pick<LoadWorkflowConfigOptions, 'cwd' | 'configFile'>): Promise<
  string | undefined
> {
  if (configFile) {
    const path = isAbsolute(configFile) ? configFile : resolve(cwd, configFile);
    assert(
      ['.ts', '.mjs', '.js'].includes(extname(path)),
      `Unsupported Workflow config extension "${extname(path)}".`
    );
    assert(
      existsSync(path) && statSync(path).isFile(),
      `Workflow config file not found: ${path}`
    );
    return path;
  }

  return findUp(
    (directory) => {
      const configs = readdirSync(directory).filter((file) =>
        file.startsWith('workflow.config.')
      );
      assert(
        configs.length <= 1,
        `Multiple Workflow config files found in ${directory}: ${configs.join(', ')}`
      );

      const config = configs[0];
      if (!config) return;

      assert(
        WORKFLOW_CONFIG_FILES.some((file) => file === config),
        `Unsupported Workflow config file "${config}".`
      );
      return join(directory, config);
    },
    { cwd }
  );
}

export async function loadWorkflowConfig(
  options: LoadWorkflowConfigOptions
): Promise<LoadedWorkflowConfig> {
  const path = await discoverWorkflowConfig(options);
  if (!path) {
    return { path, config: {} };
  }

  const configModule = await createJiti(import.meta.url, {
    interopDefault: false,
  }).import<{ default: unknown }>(path);
  const rawConfig = configModule.default;

  assert(
    rawConfig !== null &&
      typeof rawConfig === 'object' &&
      Object.getPrototypeOf(rawConfig) === Object.prototype,
    `${basename(path)} must default-export a static object.`
  );

  const config = WorkflowConfigSchema.parse(rawConfig);
  assert(
    !options.integration ||
      !config.integration ||
      config.integration.type === options.integration,
    `${basename(path)} configures "${config.integration?.type}" but was loaded by "${options.integration}".`
  );

  return { path, config };
}
