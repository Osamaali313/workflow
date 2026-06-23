import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import { setWorld } from '@workflow/core/runtime';
import type { World } from '@workflow/world';
import { resolveQueueNamespace } from '@workflow/world/queue.js';
import { afterEach, expect, it, vi } from 'vitest';
import { setupCliWorld } from './setup.js';

vi.mock('../update-check.js', () => ({
  checkForUpdateCached: () => ({ needsUpdate: false }),
}));

const project = mkdtempSync(join(tmpdir(), 'workflow-cli-world-'));
const originalCwd = process.env.WORKFLOW_OBSERVABILITY_CWD;
const originalTarget = process.env.WORKFLOW_TARGET_WORLD;

afterEach(() => {
  setWorld(undefined);
  setRuntimeWorkflowConfig(undefined);
  if (originalCwd === undefined) {
    delete process.env.WORKFLOW_OBSERVABILITY_CWD;
  } else {
    process.env.WORKFLOW_OBSERVABILITY_CWD = originalCwd;
  }
  if (originalTarget === undefined) {
    delete process.env.WORKFLOW_TARGET_WORLD;
  } else {
    process.env.WORKFLOW_TARGET_WORLD = originalTarget;
  }
  rmSync(project, { recursive: true, force: true });
});

it('uses the configured World instead of the implicit local default', async () => {
  writeFileSync(
    join(project, 'workflow.config.ts'),
    `export default {
      world: './workflow.world.mjs',
      queue: { namespace: 'configured' }
    };`
  );
  writeFileSync(
    join(project, 'workflow.world.mjs'),
    `export default () => ({ source: 'configured' });`
  );
  process.env.WORKFLOW_OBSERVABILITY_CWD = project;
  delete process.env.WORKFLOW_TARGET_WORLD;

  const world = await setupCliWorld(
    {
      json: true,
      verbose: false,
      env: 'production',
      authToken: '',
      project: '',
      team: '',
    },
    'test'
  );

  expect((world as World & { source: string }).source).toBe('configured');
  expect(process.env.WORKFLOW_TARGET_WORLD).toBeUndefined();
  expect(resolveQueueNamespace()).toBe('configured');
});
