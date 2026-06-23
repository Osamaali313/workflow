import type { World } from '@workflow/world';
import { afterEach, expect, it } from 'vitest';
import { getPublicServerConfig } from './workflow-server-actions.server.js';

const runtimeConfig = Symbol.for('@workflow/config/runtime');
const globals = globalThis as typeof globalThis & {
  [key: symbol]: { world?: () => World } | undefined;
};
const targetWorld = process.env.WORKFLOW_TARGET_WORLD;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;

afterEach(() => {
  delete globals[runtimeConfig];
  if (targetWorld === undefined) delete process.env.WORKFLOW_TARGET_WORLD;
  else process.env.WORKFLOW_TARGET_WORLD = targetWorld;
  if (deploymentId === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
  else process.env.VERCEL_DEPLOYMENT_ID = deploymentId;
});

it('identifies a configured World without treating it as local', async () => {
  delete process.env.WORKFLOW_TARGET_WORLD;
  delete process.env.VERCEL_DEPLOYMENT_ID;
  globals[runtimeConfig] = { world: () => ({}) as World };

  await expect(getPublicServerConfig()).resolves.toMatchObject({
    backendId: 'configured',
    backendDisplayName: 'Configured',
  });
});
