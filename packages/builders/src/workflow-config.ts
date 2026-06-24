import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { World } from '@workflow/world';
import { findUp } from 'find-up';
import { createJiti } from 'jiti';
import { z } from 'zod/v4';

const sourcemapSchema = z.union([
  z.boolean(),
  z.enum(['inline', 'linked', 'external', 'both']),
]);

const workflowConfigSchema = z.strictObject({
  world: z.string().min(1).optional(),
  build: z
    .strictObject({
      dirs: z.array(z.string().min(1)).min(1).optional(),
      projectRoot: z.string().min(1).optional(),
      sourcemap: sourcemapSchema.optional(),
    })
    .optional(),
});

export type SourcemapMode = z.infer<typeof sourcemapSchema>;
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export type LoadedWorkflowConfig = {
  worldModule: string | undefined;
  config: WorkflowConfig;
};

export async function loadWorkflowConfig({
  cwd,
  configFile,
}: {
  cwd: string;
  configFile?: string;
}): Promise<LoadedWorkflowConfig> {
  let path = await findUp(
    ['workflow.config.ts', 'workflow.config.mjs', 'workflow.config.js'],
    { cwd }
  );
  if (configFile) {
    path = isAbsolute(configFile) ? configFile : resolve(cwd, configFile);
    assert(
      existsSync(path) && statSync(path).isFile(),
      `Workflow config file not found: ${path}`
    );
  }

  let rawConfig: unknown = {};
  if (path) {
    const module = await createJiti(import.meta.url, {
      interopDefault: false,
    }).import<{ default: unknown }>(path);
    rawConfig = module.default;
  }
  const config = workflowConfigSchema.parse(rawConfig);
  if (!config.world) return { worldModule: undefined, config };

  assert(path);
  const world = config.world;
  assert(
    !isAbsolute(world) &&
      !win32.isAbsolute(world) &&
      !/^[a-z][a-z\d+.-]*:/i.test(world),
    `World module must be a relative path or package specifier: ${world}`
  );
  if (!world.startsWith('.')) {
    return {
      worldModule: fileURLToPath(createJiti(path).esmResolve(world)),
      config,
    };
  }

  const worldModule = resolve(dirname(path), world);
  assert(
    existsSync(worldModule) && statSync(worldModule).isFile(),
    `World module not found: ${world}`
  );
  return { worldModule, config };
}

export type WorkflowConfigLoader = typeof loadWorkflowConfig;

export async function loadWorld(worldModule: string): Promise<World> {
  const module = await createJiti(import.meta.url, {
    interopDefault: false,
  }).import<{ default: World }>(worldModule);
  return module.default;
}
