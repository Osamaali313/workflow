import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import type { World } from '@workflow/world';
import { defineWorldProvider } from '@workflow/world';
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
      world: defineWorldProvider(create),
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
});
