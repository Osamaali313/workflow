import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkflowConfig } from './load.js';
import { WorkflowConfigSchema } from './schema.js';

const tempDirs: string[] = [];

function createProject(files: Record<string, string>): string {
  const project = mkdtempSync(join(tmpdir(), 'workflow-config-'));
  tempDirs.push(project);

  for (const [file, contents] of Object.entries(files)) {
    const path = join(project, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }

  return project;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadWorkflowConfig', () => {
  it('loads the nearest TypeScript config without merging parents', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { build: { dirs: ['parent'] } };`,
      'apps/web/workflow.config.ts': `export default {
        build: { dirs: ['app'], sourcemap: false },
        integration: { type: 'next', lazyDiscovery: false }
      };`,
    });
    const app = join(project, 'apps', 'web');

    const loaded = await loadWorkflowConfig({
      cwd: app,
      integration: 'next',
    });

    expect(loaded.path).toBe(join(app, 'workflow.config.ts'));
    expect(loaded.config).toEqual({
      build: { dirs: ['app'], sourcemap: false },
      integration: { type: 'next', lazyDiscovery: false },
    });
  });

  it('rejects multiple config files in one directory', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { build: { dirs: ['typescript'] } };`,
      'workflow.config.mjs': `export default { build: { dirs: ['javascript'] } };`,
    });

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'Multiple Workflow config files found'
    );
  });

  it('rejects unsupported filenames instead of silently using a parent', async () => {
    const project = createProject({
      'app/workflow.config.json': JSON.stringify({
        build: { dirs: ['workflows'] },
      }),
    });
    const app = join(project, 'app');

    await expect(loadWorkflowConfig({ cwd: app })).rejects.toThrow(
      'Unsupported Workflow config file'
    );
  });

  it('rejects integration config for another platform', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { integration: { type: 'nest' } };`,
    });

    await expect(
      loadWorkflowConfig({
        cwd: project,
        integration: 'next',
      })
    ).rejects.toThrow('configures "nest" but was loaded by "next"');
  });

  it('rejects config functions and unknown keys', async () => {
    const project = createProject({
      'workflow.config.ts': `export default () => ({ build: { dirs: ['workflows'] } });`,
    });

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'must default-export a static object'
    );

    const promiseProject = createProject({
      'workflow.config.ts': `export default Promise.resolve({ build: { dirs: ['workflows'] } });`,
    });
    await expect(loadWorkflowConfig({ cwd: promiseProject })).rejects.toThrow(
      'must default-export a static object'
    );

    expect(() => WorkflowConfigSchema.parse({ unknown: true })).toThrow(
      'Unrecognized key'
    );
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
