import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getRuntimeWorkflowConfig } from '@workflow/config/runtime';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NestLocalBuilder } from './builder.js';
import { WorkflowModule } from './workflow.module.js';

const projects: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe('WorkflowModule', () => {
  it('loads workflow.config.ts before building', async () => {
    const project = mkdtempSync(join(tmpdir(), 'workflow-nest-config-'));
    projects.push(project);
    writeFileSync(
      join(project, 'workflow.config.ts'),
      `export default {
  world: {
    type: 'world-provider',
    create: () => { throw new Error('must stay lazy'); }
  },
  build: { dirs: ['src/jobs'], sourcemap: false },
  integration: { type: 'nest', outDir: '.generated/workflow' }
};`
    );

    let builder: NestLocalBuilder | undefined;
    const build = vi
      .spyOn(NestLocalBuilder.prototype, 'build')
      .mockImplementation(async function (this: NestLocalBuilder) {
        builder = this;
      });
    const module = new WorkflowModule({ workingDir: project });

    await module.onModuleInit();

    expect(build).toHaveBeenCalledOnce();
    expect(builder?.outDir).toBe(resolve(project, '.generated/workflow'));
    expect(getRuntimeWorkflowConfig()).toMatchObject({
      build: { dirs: ['src/jobs'], sourcemap: false },
      integration: { type: 'nest' },
    });

    await module.onModuleDestroy();
    expect(getRuntimeWorkflowConfig()).toBeUndefined();
  });
});
