import { fileURLToPath } from 'node:url';
import { createBuildQueue } from '@workflow/builders';
import {
  loadWorkflowConfig,
  type SourcemapMode,
} from '@workflow/builders/workflow-config';
import { workflowTransformPlugin } from '@workflow/rollup';
import { workflowHotUpdatePlugin } from '@workflow/vite';
import type { AstroIntegration, HookParameters } from 'astro';
import { LocalBuilder, VercelBuilder } from './builder.js';

export interface WorkflowPluginOptions {
  /**
   * Controls how source maps are emitted for workflow bundles. Accepts the
   * same values as esbuild's `sourcemap` option: `true`/`'inline'` (default),
   * `'linked'`, `'external'`, `'both'`, or `false` to omit source maps. Can
   * also be set via the `WORKFLOW_SOURCEMAP` environment variable.
   */
  sourcemap?: SourcemapMode;
}

export function workflowPlugin(
  options: WorkflowPluginOptions = {}
): AstroIntegration {
  let builderConfig: ConstructorParameters<typeof LocalBuilder>[0];
  let worldModule: string | undefined;
  let builder: LocalBuilder;
  const enqueue = createBuildQueue();

  return {
    name: 'workflow:astro',
    hooks: {
      'astro:config:setup': async ({
        config,
        updateConfig,
      }: HookParameters<'astro:config:setup'>) => {
        const workingDir = fileURLToPath(config.root);
        const loaded = await loadWorkflowConfig({ cwd: workingDir });
        const build = loaded.config.build;
        worldModule = loaded.worldModule;
        builderConfig = {
          workingDir,
          dirs: build?.dirs,
          projectRoot: build?.projectRoot,
          runtimeConfig: loaded.config.runtime,
          worldModule,
          sourcemap:
            options.sourcemap ??
            (process.env.WORKFLOW_SOURCEMAP ? undefined : build?.sourcemap),
        };
        builder = new LocalBuilder(builderConfig);
        if (!process.env.VERCEL_DEPLOYMENT_ID) {
          await builder.build();
        }
        updateConfig({
          vite: {
            ...(worldModule
              ? {
                  resolve: {
                    alias: { '@workflow/world/configured': worldModule },
                  },
                  ssr: { noExternal: ['workflow', '@workflow/core'] },
                }
              : {}),
            plugins: [
              workflowTransformPlugin(),
              // Cast needed due to Astro using a different internal Vite version
              workflowHotUpdatePlugin({
                builder: () => builder,
                enqueue,
              }) as any,
            ],
          },
        });
      },
      'astro:build:done': async () => {
        if (process.env.VERCEL_DEPLOYMENT_ID) {
          const vercelBuilder = new VercelBuilder(builderConfig);
          await vercelBuilder.build();
        }
      },
    },
  };
}
