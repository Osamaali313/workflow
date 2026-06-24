import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadWorkflowConfig } from './workflow-config.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(process.cwd(), '.workflow-config-'));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

it('resolves a package World to a filesystem path', async () => {
  writeFileSync(
    join(project, 'workflow.config.mjs'),
    `export default { world: '@workflow/world' };`
  );

  const config = await loadWorkflowConfig({ cwd: project });

  assert(config.worldModule);
  expect(isAbsolute(config.worldModule)).toBe(true);
  expect(config.worldModule).not.toMatch(/^file:/);
});
