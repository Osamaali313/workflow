import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import type { World } from '@workflow/world';
import {
  defineWorldProvider,
  setWorkflowQueueNamespace,
} from '@workflow/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeWorld,
  createWorld,
  getWorld,
  getWorldHandlers,
  setWorld,
} from './world.js';

const originalTargetWorld = process.env.WORKFLOW_TARGET_WORLD;

function mockWorld(overrides: Partial<World> = {}): World {
  return {
    createQueueHandler: vi.fn(),
    ...overrides,
  } as unknown as World;
}

afterEach(async () => {
  await closeWorld();
  setWorld(undefined);
  setRuntimeWorkflowConfig(undefined);
  setWorkflowQueueNamespace(undefined);
  vi.restoreAllMocks();
  if (originalTargetWorld === undefined) {
    delete process.env.WORKFLOW_TARGET_WORLD;
  } else {
    process.env.WORKFLOW_TARGET_WORLD = originalTargetWorld;
  }
});

describe('configured World lifecycle', () => {
  it('creates and starts one shared World at runtime', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const start = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const world = mockWorld({ start, close, specVersion: 4 });
    const create = vi.fn(async () => world);
    setRuntimeWorkflowConfig({
      world: defineWorldProvider({
        id: 'test-world',
        create,
      }),
      queue: { namespace: 'myapp' },
    });

    const [resolvedWorld, handlers] = await Promise.all([
      getWorld(),
      getWorldHandlers(),
    ]);

    expect(resolvedWorld).toBe(world);
    expect(handlers.specVersion).toBe(4);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith();
    expect(start).toHaveBeenCalledOnce();

    await closeWorld();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not start a fresh World returned by createWorld()', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const start = vi.fn(async () => {});
    setRuntimeWorkflowConfig({
      world: defineWorldProvider({
        id: 'test-world',
        create: () => mockWorld({ start }),
      }),
    });

    await createWorld();

    expect(start).not.toHaveBeenCalled();
  });

  it('clears a failed provider promise so the next call can retry', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const world = mockWorld();
    const create = vi
      .fn<() => Promise<World>>()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(world);
    setRuntimeWorkflowConfig({
      world: defineWorldProvider({
        id: 'test-world',
        create,
      }),
    });

    await expect(getWorld()).rejects.toThrow('not ready');
    await expect(getWorld()).resolves.toBe(world);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not instantiate a World during cleanup', async () => {
    const create = vi.fn(() => mockWorld());
    setRuntimeWorkflowConfig({
      world: defineWorldProvider({
        id: 'test-world',
        create,
      }),
    });

    await closeWorld();

    expect(create).not.toHaveBeenCalled();
  });

  it('prefers configured providers over WORKFLOW_TARGET_WORLD', async () => {
    process.env.WORKFLOW_TARGET_WORLD = 'local';
    const world = mockWorld();
    setRuntimeWorkflowConfig({
      world: defineWorldProvider({
        id: 'test-world',
        create: () => world,
      }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(getWorld()).resolves.toBe(world);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('WORKFLOW_TARGET_WORLD="local" is ignored')
    );
  });
});
