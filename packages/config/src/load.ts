import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import { createJiti } from 'jiti';
import {
  type WorkflowConfig,
  WorkflowConfigSchema,
  type WorkflowIntegrationType,
} from './schema.js';

const WORKFLOW_CONFIG_FILES = [
  'workflow.config.ts',
  'workflow.config.mts',
  'workflow.config.js',
  'workflow.config.mjs',
] as const;

const UNSUPPORTED_WORKFLOW_CONFIG_FILES = [
  'workflow.config.cjs',
  'workflow.config.cts',
  'workflow.config.json',
  'workflow.config.jsx',
  'workflow.config.tsx',
] as const;

export type LoadWorkflowConfigOptions = {
  cwd: string;
  configFile?: string;
  integration?: WorkflowIntegrationType;
};

export type LoadedWorkflowConfig =
  | {
      found: false;
      config: WorkflowConfig;
    }
  | {
      found: true;
      path: string;
      config: WorkflowConfig;
    };

function isSearchRoot(dir: string): boolean {
  if (
    existsSync(join(dir, '.git')) ||
    existsSync(join(dir, 'pnpm-workspace.yaml'))
  ) {
    return true;
  }

  const packageJsonPath = join(dir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson: unknown = JSON.parse(
    readFileSync(packageJsonPath, 'utf8')
  );
  assert(
    packageJson !== null &&
      typeof packageJson === 'object' &&
      !Array.isArray(packageJson),
    `${packageJsonPath} must contain an object.`
  );
  return 'workspaces' in packageJson;
}

function discoverWorkflowConfig({
  cwd,
  configFile,
}: Pick<LoadWorkflowConfigOptions, 'cwd' | 'configFile'>): string | undefined {
  if (configFile) {
    const path = isAbsolute(configFile) ? configFile : resolve(cwd, configFile);
    assert(
      ['.ts', '.mts', '.js', '.mjs'].includes(extname(path)),
      `Unsupported Workflow config extension "${extname(path)}".`
    );
    assert(
      existsSync(path) && statSync(path).isFile(),
      `Workflow config file not found: ${path}`
    );
    return path;
  }

  let dir = resolve(cwd);
  while (true) {
    const unsupported = UNSUPPORTED_WORKFLOW_CONFIG_FILES.filter((file) =>
      existsSync(join(dir, file))
    );
    assert(
      unsupported.length === 0,
      `Unsupported Workflow config file "${unsupported[0]}".`
    );

    const configs = WORKFLOW_CONFIG_FILES.filter((file) =>
      existsSync(join(dir, file))
    );
    assert(
      configs.length <= 1,
      `Multiple Workflow config files found in ${dir}: ${configs.join(', ')}`
    );
    if (configs[0]) {
      return join(dir, configs[0]);
    }

    if (isSearchRoot(dir)) {
      return;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

export async function loadWorkflowConfig(
  options: LoadWorkflowConfigOptions
): Promise<LoadedWorkflowConfig> {
  const path = discoverWorkflowConfig(options);
  if (!path) {
    return { found: false, config: {} };
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

  return { found: true, path, config };
}

export type WorkflowConfigLoader = typeof loadWorkflowConfig;
