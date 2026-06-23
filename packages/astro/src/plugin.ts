import { fileURLToPath } from 'node:url';
import { createBuildQueue } from '@workflow/builders';
import type { SourcemapMode } from '@workflow/config';
import {
  type LoadedWorkflowConfig,
  loadWorkflowConfig,
} from '@workflow/config/load';
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
  let builderConfig: {
    workingDir: string;
    workflowConfig: LoadedWorkflowConfig;
  };
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
        builderConfig = {
          workingDir,
          workflowConfig: await loadWorkflowConfig({
            cwd: workingDir,
            integration: 'astro',
          }),
        };
        builder = new LocalBuilder({
          ...builderConfig,
          sourcemap: options.sourcemap,
        });
        if (!process.env.VERCEL_DEPLOYMENT_ID) {
          await builder.build();
        }
        updateConfig({
          vite: {
            ...(builderConfig.workflowConfig.runtimePath
              ? { ssr: { noExternal: ['workflow', '@workflow/core'] } }
              : {}),
            plugins: [
              workflowTransformPlugin(),
              {
                name: 'workflow:runtime-config',
                enforce: 'pre',
                resolveId(source) {
                  if (source === '@workflow/config/runtime-binding') {
                    return builderConfig.workflowConfig.runtimePath;
                  }
                },
              },
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
          const vercelBuilder = new VercelBuilder({
            ...builderConfig,
            sourcemap: options.sourcemap,
          });
          await vercelBuilder.build();
        }
      },
    },
  };
}
