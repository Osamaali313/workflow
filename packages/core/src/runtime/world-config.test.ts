import type { World } from '@workflow/world';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorld, getWorldHandlers, setWorld } from './world.js';

const configured = vi.hoisted(() => ({
  loaded: false,
  world: {} as unknown,
}));

vi.mock('@workflow/world/configured', () => {
  configured.loaded = true;
  return { default: configured.world };
});

afterEach(() => {
  configured.loaded = false;
  configured.world = {};
  setWorld(undefined);
  vi.unstubAllEnvs();
});

it('does not load the configured World when the environment overrides it', async () => {
  vi.stubEnv('WORKFLOW_TARGET_WORLD', 'local');

  const world = await createWorld();

  expect(configured.loaded).toBe(false);
  await world.close?.();
});

it('does not load the configured World when a World is injected', async () => {
  const world = {
    createQueueHandler: vi.fn(),
    specVersion: 1,
  } as unknown as World;
  setWorld(world);

  expect(await getWorldHandlers()).toBe(world);
  expect(configured.loaded).toBe(false);
});

it('reuses the initialized runtime World for handlers', async () => {
  const world = {
    createQueueHandler: vi.fn(),
    specVersion: 1,
  } as unknown as World;
  const WorldCache = Symbol.for('@workflow/world//cache');
  (globalThis as { [key: symbol]: World | undefined })[WorldCache] = world;

  expect(await getWorldHandlers()).toBe(world);
  expect(configured.loaded).toBe(false);
});

it('rejects a configured module without a default World export', async () => {
  vi.stubEnv('WORKFLOW_TARGET_WORLD', '');
  delete process.env.WORKFLOW_TARGET_WORLD;
  configured.world = undefined;

  await expect(createWorld()).rejects.toThrow(
    'Configured World module must default-export a World'
  );
});
