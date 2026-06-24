import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setWorld } from '@workflow/core/runtime';
import type { World } from '@workflow/world';
import { afterEach, expect, it, vi } from 'vitest';
import { getWorkflowConfig } from '../config/workflow-config.js';
import { setupCliWorld } from './setup.js';

vi.mock('../update-check.js', () => ({
  checkForUpdateCached: () => ({ needsUpdate: false }),
}));

const project = mkdtempSync(join(tmpdir(), 'workflow-cli-world-'));

afterEach(() => {
  setWorld(undefined);
  vi.unstubAllEnvs();
  delete (globalThis as { __workflowCliWorldStarted?: boolean })
    .__workflowCliWorldStarted;
  rmSync(project, { recursive: true, force: true });
});

it('uses the configured World instead of the implicit local default', async () => {
  writeFileSync(
    join(project, 'workflow.config.ts'),
    `export default {
      world: './workflow.world.mjs',
      build: { dirs: ['jobs'] }
    };`
  );
  writeFileSync(
    join(project, 'workflow.world.mjs'),
    `export default () => ({
      source: 'configured',
      start() { globalThis.__workflowCliWorldStarted = true; }
    });`
  );
  vi.stubEnv('WORKFLOW_OBSERVABILITY_CWD', project);
  vi.stubEnv('WORKFLOW_TARGET_WORLD', '');
  delete process.env.WORKFLOW_TARGET_WORLD;

  const config = await getWorkflowConfig({ buildTarget: 'standalone' });
  expect(config.dirs).toEqual(['jobs']);
  expect(config.worldModule).toBe(join(project, 'workflow.world.mjs'));

  const world = await setupCliWorld(
    {
      json: true,
      verbose: false,
    },
    'test'
  );

  expect((world as World & { source: string }).source).toBe('configured');
  expect(
    (globalThis as { __workflowCliWorldStarted?: boolean })
      .__workflowCliWorldStarted
  ).toBe(true);
  expect(process.env.WORKFLOW_TARGET_WORLD).toBe('configured');
});
