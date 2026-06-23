import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getWorkflowConfig } from './workflow-config.js';

describe('getWorkflowConfig', () => {
  const originalCwd = process.env.WORKFLOW_OBSERVABILITY_CWD;
  const workingDir = mkdtempSync(join(tmpdir(), 'workflow-cli-config-'));

  afterEach(() => {
    if (originalCwd === undefined) {
      delete process.env.WORKFLOW_OBSERVABILITY_CWD;
    } else {
      process.env.WORKFLOW_OBSERVABILITY_CWD = originalCwd;
    }
    rmSync(workingDir, { recursive: true, force: true });
  });

  it('scans the project by default and honors configured directories', async () => {
    process.env.WORKFLOW_OBSERVABILITY_CWD = workingDir;
    expect((await getWorkflowConfig()).dirs).toEqual(['.']);

    writeFileSync(
      join(workingDir, 'workflow.config.ts'),
      `export default { build: { dirs: ['jobs'] } };`
    );
    expect((await getWorkflowConfig()).dirs).toEqual(['jobs']);
  });
});
