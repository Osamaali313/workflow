import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { World } from '@workflow/world';
import { defineWorldProvider } from '@workflow/world';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkflowConfig } from './load.js';
import { WorkflowConfigSchema } from './schema.js';

const tempDirs: string[] = [];

function createProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'workflow-config-'));
  mkdirSync(join(project, '.git'));
  tempDirs.push(project);
  return project;
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadWorkflowConfig', () => {
  it('loads the nearest TypeScript config without merging parents', async () => {
    const project = createProject();
    const app = join(project, 'apps', 'web');
    writeFile(
      join(project, 'workflow.config.ts'),
      `export default { build: { dirs: ['parent'] } };`
    );
    writeFile(
      join(app, 'workflow.config.ts'),
      `export default {
        build: { dirs: ['app'], sourcemap: false },
        integration: { type: 'next', lazyDiscovery: false }
      };`
    );

    const loaded = await loadWorkflowConfig({
      cwd: app,
      integration: 'next',
    });

    assert(loaded.found);
    expect(loaded.path).toBe(join(app, 'workflow.config.ts'));
    expect(loaded.config).toEqual({
      build: { dirs: ['app'], sourcemap: false },
      integration: { type: 'next', lazyDiscovery: false },
    });
  });

  it('rejects multiple config files in one directory', async () => {
    const project = createProject();
    writeFile(
      join(project, 'workflow.config.ts'),
      `export default { build: { dirs: ['typescript'] } };`
    );
    writeFile(
      join(project, 'workflow.config.mjs'),
      `export default { build: { dirs: ['javascript'] } };`
    );

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'Multiple Workflow config files found'
    );
  });

  it('rejects unsupported filenames instead of silently using a parent', async () => {
    const project = createProject();
    const app = join(project, 'app');
    writeFile(
      join(app, 'workflow.config.json'),
      JSON.stringify({ build: { dirs: ['workflows'] } })
    );

    await expect(loadWorkflowConfig({ cwd: app })).rejects.toThrow(
      'Unsupported Workflow config file'
    );
  });

  it('rejects integration config for another platform', async () => {
    const project = createProject();
    writeFile(
      join(project, 'workflow.config.ts'),
      `export default { integration: { type: 'nest' } };`
    );

    await expect(
      loadWorkflowConfig({
        cwd: project,
        integration: 'next',
      })
    ).rejects.toThrow('configures "nest" but was loaded by "next"');
  });

  it('rejects config functions and unknown keys', async () => {
    const project = createProject();
    writeFile(
      join(project, 'workflow.config.ts'),
      `export default () => ({ build: { dirs: ['workflows'] } });`
    );

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'must default-export a static object'
    );

    const promiseProject = createProject();
    writeFile(
      join(promiseProject, 'workflow.config.ts'),
      `export default Promise.resolve({ build: { dirs: ['workflows'] } });`
    );
    await expect(loadWorkflowConfig({ cwd: promiseProject })).rejects.toThrow(
      'must default-export a static object'
    );

    expect(() => WorkflowConfigSchema.parse({ unknown: true })).toThrow(
      'Unrecognized key'
    );
  });

  it('accepts a typed inert WorldProvider', () => {
    const provider = defineWorldProvider({
      id: 'test-world',
      create: () => ({}) as World,
    });

    expect(WorkflowConfigSchema.parse({ world: provider })).toEqual({
      world: provider,
    });
    expect(() => WorkflowConfigSchema.parse({ world: {} })).toThrow();
  });

  it('rejects empty single-setting sections', () => {
    expect(() => WorkflowConfigSchema.parse({ queue: {} })).toThrow();
    expect(() =>
      WorkflowConfigSchema.parse({
        integration: { type: 'next', local: {} },
      })
    ).toThrow();
  });

  it('rejects mixed integration settings', () => {
    expect(() =>
      WorkflowConfigSchema.parse({
        integration: {
          type: 'next',
          typescriptPlugin: true,
        },
      })
    ).toThrow();
  });
});
