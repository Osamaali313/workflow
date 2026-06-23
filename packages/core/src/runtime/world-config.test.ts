import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import type { World } from '@workflow/world';
import { resolveQueueNamespace } from '@workflow/world/queue.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorldLazy } from './get-world-lazy.js';
import { closeWorld, getWorld, getWorldHandlers, setWorld } from './world.js';

const targetWorld = process.env.WORKFLOW_TARGET_WORLD;

afterEach(async () => {
  await closeWorld();
  setRuntimeWorkflowConfig(undefined);
  if (targetWorld === undefined) {
    delete process.env.WORKFLOW_TARGET_WORLD;
  } else {
    process.env.WORKFLOW_TARGET_WORLD = targetWorld;
  }
});

describe('configured World', () => {
  it('creates, starts, shares, and closes one lazy World', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const start = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const world = {
      createQueueHandler: vi.fn(),
      specVersion: 4,
      start,
      close,
    } as unknown as World;
    const create = vi.fn(() => world);

    setRuntimeWorkflowConfig({
      world: create,
      queue: { namespace: 'app' },
    });

    expect(resolveQueueNamespace()).toBe('app');
    expect(create).not.toHaveBeenCalled();
    const [resolved, handlers] = await Promise.all([
      getWorld(),
      getWorldHandlers(),
    ]);

    expect(resolved).toBe(world);
    expect(handlers.specVersion).toBe(4);
    expect(create).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();

    await closeWorld();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes a World whose startup fails before retrying', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const firstClose = vi.fn(async () => {});
    const first = {
      start: vi.fn().mockRejectedValue(new Error('startup failed')),
      close: firstClose,
    } as unknown as World;
    const second = {
      start: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    } as unknown as World;
    const create = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    setRuntimeWorkflowConfig({ world: create });

    await expect(getWorld()).rejects.toThrow('startup failed');
    expect(firstClose).toHaveBeenCalledOnce();
    await expect(getWorld()).resolves.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects a configured provider that returns no World', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    setRuntimeWorkflowConfig({ world: () => undefined as never });

    await expect(getWorld()).rejects.toThrow(
      'Configured World provider must return a World.'
    );
  });

  it('requires managed Worlds to be closed before reset', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const close = vi.fn(async () => {});
    setRuntimeWorkflowConfig({
      world: () =>
        ({
          start: vi.fn(async () => {}),
          close,
        }) as unknown as World,
    });

    await getWorld();
    expect(() => setWorld(undefined)).toThrow(
      'Call await closeWorld() before replacing a managed World.'
    );
    await closeWorld();
    expect(close).toHaveBeenCalledOnce();
    expect(() => setWorld(undefined)).not.toThrow();
  });

  it('does not cache a World closed during startup', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    let finishStart!: () => void;
    const starting = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const firstClose = vi.fn(async () => {});
    const first = {
      start: vi.fn(() => starting),
      close: firstClose,
    } as unknown as World;
    const second = {
      start: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    } as unknown as World;
    const create = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    setRuntimeWorkflowConfig({ world: create });

    const pendingWorld = getWorld();
    const pendingLazyWorld = getWorldLazy();
    const closingWorld = closeWorld();
    finishStart();

    await expect(pendingWorld).resolves.toBe(first);
    await expect(pendingLazyWorld).resolves.toBe(first);
    await closingWorld;
    expect(firstClose).toHaveBeenCalledOnce();
    await expect(getWorld()).resolves.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('waits for cleanup before starting a replacement World', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const first = {
      start: vi.fn(async () => {}),
      close: vi.fn(() => closing),
    } as unknown as World;
    const second = {
      start: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    } as unknown as World;
    const create = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    setRuntimeWorkflowConfig({ world: create });

    await getWorld();
    const close = closeWorld();
    const replacement = getWorld();
    const replacementAfterConcurrentClose = closeWorld().then(() => getWorld());
    expect(() => setWorld(second)).toThrow(
      'Cannot replace a World while it is closing.'
    );
    expect(create).toHaveBeenCalledOnce();

    finishClose();
    await close;
    await expect(replacement).resolves.toBe(second);
    await expect(replacementAfterConcurrentClose).resolves.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps a World cached when cleanup fails', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD;
    const world = {
      start: vi.fn(async () => {}),
      close: vi
        .fn()
        .mockRejectedValueOnce(new Error('close failed'))
        .mockResolvedValueOnce(undefined),
    } as unknown as World;
    const create = vi.fn(() => world);
    setRuntimeWorkflowConfig({ world: create });

    await getWorld();
    await expect(closeWorld()).rejects.toThrow('close failed');
    await expect(getWorld()).resolves.toBe(world);
    expect(create).toHaveBeenCalledOnce();
  });
});
