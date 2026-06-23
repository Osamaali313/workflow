import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkflowConfig } from './load.js';
import type { RuntimeWorkflowConfig } from './runtime-binding.js';
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
  delete (globalThis as { __workflowWorldImports?: number })
    .__workflowWorldImports;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadWorkflowConfig', () => {
  it('returns empty config when no config file exists', async () => {
    const project = createProject({});

    await expect(loadWorkflowConfig({ cwd: project })).resolves.toEqual({
      path: undefined,
      runtimePath: undefined,
      config: {},
    });
  });

  it('allows config without a World provider', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { queue: { namespace: 'app' } };`,
    });
    const loaded = await loadWorkflowConfig({ cwd: project });
    const runtime = (await import(
      pathToFileURL(loaded.runtimePath as string).href
    )) as { default: RuntimeWorkflowConfig };

    expect(runtime.default).toEqual({
      world: undefined,
      queue: { namespace: 'app' },
    });
  });

  it('loads the nearest TypeScript config without merging parents', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { build: { dirs: ['parent'] } };`,
      'apps/web/workflow.config.ts': `export default {
        build: { dirs: ['app'], sourcemap: false },
        integration: { type: 'next' }
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
      integration: { type: 'next' },
    });
  });

  it('generates a runtime binding without loading the World module', async () => {
    const project = createProject({
      'workflow.world.ts': `throw new Error('must stay lazy');`,
      'workflow.config.ts': `export default {
        world: './workflow.world.ts',
        build: { dirs: ['jobs'] },
        queue: { namespace: 'app' }
      };`,
    });

    const loaded = await loadWorkflowConfig({ cwd: project });
    const runtimeSource = readFileSync(loaded.runtimePath as string, 'utf8');

    expect(loaded.config.world).toBe('./workflow.world.ts');
    expect(runtimeSource).toContain('workflow.world.ts');
    expect(runtimeSource).toContain('queue: {"namespace":"app"}');
    expect(runtimeSource).not.toContain("dirs: ['jobs']");
  });

  it('loads the World module only when its provider runs', async () => {
    const globals = globalThis as typeof globalThis & {
      __workflowWorldImports?: number;
    };
    const project = createProject({
      'workflow.world.mjs': `
globalThis.__workflowWorldImports = (globalThis.__workflowWorldImports ?? 0) + 1;
export default () => ({});
`,
      'workflow.config.ts': `export default { world: './workflow.world.mjs' };`,
    });
    const loaded = await loadWorkflowConfig({ cwd: project });

    const runtime = (await import(
      pathToFileURL(loaded.runtimePath as string).href
    )) as {
      default: RuntimeWorkflowConfig;
    };
    expect(globals.__workflowWorldImports).toBeUndefined();

    await runtime.default.world?.();
    expect(globals.__workflowWorldImports).toBe(1);
  });

  it('validates World package specifiers', async () => {
    const project = createProject({
      'node_modules/community-world/package.json': JSON.stringify({
        name: 'community-world',
        type: 'module',
        exports: { import: './index.js' },
      }),
      'node_modules/community-world/index.js': `export default () => ({});`,
      'workflow.config.ts': `export default { world: 'community-world' };`,
    });

    const loaded = await loadWorkflowConfig({ cwd: project });

    expect(readFileSync(loaded.runtimePath as string, 'utf8')).toContain(
      'import("community-world")'
    );
  });

  it('rejects missing World modules', async () => {
    const project = createProject({
      'workflow.config.ts': `export default { world: './missing.ts' };`,
    });

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'World module not found: ./missing.ts'
    );
  });

  it('rejects absolute World paths', async () => {
    const project = createProject({
      'workflow.world.ts': `export default () => ({});`,
    });
    writeFileSync(
      join(project, 'workflow.config.ts'),
      `export default { world: ${JSON.stringify(join(project, 'workflow.world.ts'))} };`
    );

    await expect(loadWorkflowConfig({ cwd: project })).rejects.toThrow(
      'World module must be a relative path or package specifier'
    );
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
      'workflow.config.ts': `export default { integration: { type: 'nitro' } };`,
    });

    await expect(
      loadWorkflowConfig({
        cwd: project,
        integration: 'next',
      })
    ).rejects.toThrow('configures "nitro" but was loaded by "next"');
  });

  it('rejects top-level config functions and unknown keys', async () => {
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

  it('rejects an empty queue section', () => {
    expect(() => WorkflowConfigSchema.parse({ queue: {} })).toThrow();
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
