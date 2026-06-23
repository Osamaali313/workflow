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
  win32,
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

export type LoadedWorkflowConfig = {
  path: string | undefined;
  runtimePath: string | undefined;
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

async function readWorkflowConfig(
  path: string,
  integration: WorkflowIntegrationType | undefined
): Promise<WorkflowConfig> {
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
  if (!integration || !config.integration) return config;

  assert(
    config.integration.type === integration,
    `${basename(path)} configures "${config.integration.type}" but was loaded by "${integration}".`
  );
  return config;
}

export async function loadWorkflowConfig(
  options: LoadWorkflowConfigOptions
): Promise<LoadedWorkflowConfig> {
  const path = await discoverWorkflowConfig(options);
  let config: WorkflowConfig = path
    ? await readWorkflowConfig(path, options.integration)
    : {};

  if (process.env.WORKFLOW_QUEUE_NAMESPACE !== undefined) {
    config = WorkflowConfigSchema.parse({
      ...config,
      queue: { namespace: process.env.WORKFLOW_QUEUE_NAMESPACE },
    });
  }

  if (!config.world && !config.queue) {
    return { path, runtimePath: undefined, config };
  }

  const runtimeDir = join(
    path ? dirname(path) : options.cwd,
    'node_modules',
    '.cache',
    'workflow'
  );
  let world = config.world;
  if (world) {
    assert(path);
    assert(
      !isAbsolute(world) &&
        !win32.isAbsolute(world) &&
        !/^[a-z][a-z\d+.-]*:/i.test(world),
      `World module must be a relative path or package specifier: ${world}`
    );
    if (world.startsWith('.')) {
      const worldPath = resolve(dirname(path), world);
      assert(
        existsSync(worldPath) && statSync(worldPath).isFile(),
        `World module not found: ${world}`
      );
      world = relative(runtimeDir, worldPath).replaceAll('\\', '/');
      if (!world.startsWith('.')) world = `./${world}`;
    } else {
      createJiti(path).esmResolve(world);
    }
  }

  const runtimePath = join(runtimeDir, 'runtime-config.mjs');
  const worldFactory = world
    ? `async () => { const provider = (await import(${JSON.stringify(world)})).default; return provider(); }`
    : 'undefined';
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    runtimePath,
    `const world = ${worldFactory};\nconst config = { world, queue: ${JSON.stringify(config.queue)} };\nglobalThis[Symbol.for('@workflow/config/runtime')] = config;\nexport default config;\n`
  );

  return { path, runtimePath, config };
}

export function createRuntimeWorkflowConfig({
  path,
  config,
}: LoadedWorkflowConfig): RuntimeWorkflowConfig {
  if (!config.world) return { queue: config.queue };

  assert(path);
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
