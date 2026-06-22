import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import type { WorldProvider } from '@workflow/world';
import { findUp } from 'find-up';
import { createJiti } from 'jiti';
import type { RuntimeWorkflowConfig } from './runtime-binding.js';
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

export type LoadedWorkflowConfig =
  | { path: undefined; runtimePath: undefined; config: WorkflowConfig }
  | { path: string; runtimePath: string; config: WorkflowConfig };

type FoundWorkflowConfig = Extract<LoadedWorkflowConfig, { path: string }>;

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
    return { path: undefined, runtimePath: undefined, config: {} };
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

  const runtimeDir = join(dirname(path), 'node_modules', '.cache', 'workflow');
  let world = config.world;
  if (world?.startsWith('.') || (world && isAbsolute(world))) {
    const worldPath = resolve(dirname(path), world);
    assert(
      existsSync(worldPath) && statSync(worldPath).isFile(),
      `World module not found: ${world}`
    );
    world = relative(runtimeDir, worldPath).replaceAll('\\', '/');
    if (!world.startsWith('.')) world = `./${world}`;
  } else if (world) {
    createJiti(path).esmResolve(world);
  }

  const runtimePath = join(runtimeDir, 'runtime-config.mjs');
  const worldFactory = world
    ? `async () => { const provider = (await import(${JSON.stringify(world)})).default; return provider(); }`
    : 'undefined';
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    runtimePath,
    `const world = ${worldFactory};\nexport default { world, queue: ${JSON.stringify(config.queue)} };\n`
  );

  return { path, runtimePath, config };
}

export function createRuntimeWorkflowConfig({
  path,
  config,
}: FoundWorkflowConfig): RuntimeWorkflowConfig {
  if (!config.world) return { queue: config.queue };

  const world = config.world;
  const jiti = createJiti(path, { interopDefault: false });
  return {
    queue: config.queue,
    world: async () => {
      const module = await jiti.import<{ default: WorldProvider }>(world);
      return module.default();
    },
  };
}
