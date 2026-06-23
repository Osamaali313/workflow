import { createBuildQueue } from '@workflow/builders';
import { loadWorkflowConfig } from '@workflow/config/load';
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
  sourcemap?: boolean | 'inline' | 'linked' | 'external' | 'both';
}

export function workflowPlugin(
  options: WorkflowPluginOptions = {}
): AstroIntegration {
  const workflowConfig = loadWorkflowConfig({ cwd: process.cwd() });
  let builder: LocalBuilder;
  const enqueue = createBuildQueue();

  return {
    name: 'workflow:astro',
    hooks: {
      'astro:config:setup': async ({
        updateConfig,
      }: HookParameters<'astro:config:setup'>) => {
        const loadedConfig = await workflowConfig;
        builder = new LocalBuilder({
          sourcemap: options.sourcemap,
          workflowConfig: loadedConfig,
        });
        // Use local builder
        if (!process.env.VERCEL_DEPLOYMENT_ID) {
          try {
            await builder.build();
          } catch (buildError) {
            // Build might fail due to invalid workflow files or missing dependencies
            // Log the error and rethrow to properly propagate to Astro
            console.error('Build failed during config setup:', buildError);
            throw buildError;
          }
        }
        updateConfig({
          vite: {
            ...(loadedConfig.runtimePath
              ? { ssr: { noExternal: ['workflow', '@workflow/core'] } }
              : {}),
            plugins: [
              workflowTransformPlugin(),
              {
                name: 'workflow:runtime-config',
                enforce: 'pre',
                resolveId(source) {
                  if (source === '@workflow/config/runtime-binding') {
                    return loadedConfig.runtimePath;
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
            sourcemap: options.sourcemap,
            workflowConfig: await workflowConfig,
          });
          await vercelBuilder.build();
        }
      },
    },
  };
}
