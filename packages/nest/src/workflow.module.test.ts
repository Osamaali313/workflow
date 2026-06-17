import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NestLocalBuilder } from './builder.js';
import { WorkflowModule } from './workflow.module.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('WorkflowModule workflow.config.ts', () => {
  it('loads Nest and generic build settings before creating the builder', async () => {
    const project = mkdtempSync(join(tmpdir(), 'workflow-nest-config-'));
    tempDirs.push(project);
    mkdirSync(join(project, '.git'));
    writeFileSync(
      join(project, 'workflow.config.ts'),
      `export default {
  build: {
    dirs: ['src/jobs'],
    projectRoot: '..',
    externalPackages: ['sharp'],
    sourcemap: false,
    manifest: { output: 'workflow-manifest.json' }
  },
  queue: { namespace: 'myapp' },
  integration: {
    type: 'nest',
    moduleType: 'commonjs',
    outDir: '.generated/workflow',
    distDir: 'build',
    watch: true
  }
};`
    );

    let builder: NestLocalBuilder | undefined;
    let builderConfig: Record<string, unknown> | undefined;
    vi.spyOn(NestLocalBuilder.prototype, 'build').mockImplementation(
      async function (this: NestLocalBuilder) {
        builder = this;
        builderConfig = (this as unknown as { config: Record<string, unknown> })
          .config;
      }
    );

    @Module({
      imports: [WorkflowModule.forRoot({ workingDir: project })],
    })
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    expect(builderConfig).toMatchObject({
      dirs: ['src/jobs'],
      workingDir: project,
      projectRoot: resolve(project, '..'),
      externalPackages: ['sharp'],
      watch: true,
      workflowConfig: {
        found: true,
        path: join(project, 'workflow.config.ts'),
        config: {
          build: {
            manifest: { output: 'workflow-manifest.json' },
          },
          queue: { namespace: 'myapp' },
        },
      },
    });
    expect(builder?.outDir).toBe('.generated/workflow');
    await app.close();
  });
});
