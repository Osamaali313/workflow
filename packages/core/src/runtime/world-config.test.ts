import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import type { World } from '@workflow/world';
import { setWorkflowQueueNamespace } from '@workflow/world/queue.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWorld, getWorld, getWorldHandlers } from './world.js';

const targetWorld = process.env.WORKFLOW_TARGET_WORLD;

afterEach(async () => {
  await closeWorld();
  setRuntimeWorkflowConfig(undefined);
  setWorkflowQueueNamespace(undefined);
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
    const closingWorld = closeWorld();
    finishStart();

    await expect(pendingWorld).resolves.toBe(first);
    await closingWorld;
    expect(firstClose).toHaveBeenCalledOnce();
    await expect(getWorld()).resolves.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
