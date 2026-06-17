import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  BaseBuilder,
  createBaseBuilderConfig,
  VercelBuildOutputAPIBuilder,
} from '@workflow/builders';
import type { LoadedWorkflowConfig } from '@workflow/config/load';
import type { Nitro } from 'nitro/types';
import { join, resolve } from 'pathe';

type NitroV2ExternalsOptions = { externals?: { external?: unknown[] } };

function createNitroBuilderConfig(
  nitro: Nitro,
  loadedConfig: LoadedWorkflowConfig
) {
  const build = loadedConfig.config.build;
  // Nitro v3 dropped `externals.external`, so this v2-shaped read is empty.
  const nitroExternals =
    (nitro.options as NitroV2ExternalsOptions).externals?.external ?? [];
  const externalPackages = [
    ...new Set([
      ...(build?.externalPackages ?? []),
      ...nitroExternals.filter(
        (entry): entry is string => typeof entry === 'string'
      ),
    ]),
  ];

  return createBaseBuilderConfig({
    workingDir: nitro.options.rootDir,
    dirs: nitro.options.workflow?.dirs ?? build?.dirs ?? ['.'],
    projectRoot: build?.projectRoot
      ? resolve(nitro.options.rootDir, build.projectRoot)
      : undefined,
    sourcemap: nitro.options.workflow?.sourcemap,
    externalPackages:
      externalPackages.length > 0 ? externalPackages : undefined,
    workflowConfig: loadedConfig,
  });
}

export class VercelBuilder extends VercelBuildOutputAPIBuilder {
  constructor(nitro: Nitro, loadedConfig: LoadedWorkflowConfig) {
    super({
      ...createNitroBuilderConfig(nitro, loadedConfig),
      runtime: nitro.options.workflow?.runtime,
      buildTarget: 'vercel-build-output-api',
    });
  }
  override async build(): Promise<void> {
    const configPath = join(
      this.config.workingDir,
      '.vercel/output/config.json'
    );
    const originalConfig = JSON.parse(await readFile(configPath, 'utf-8'));
    await super.build();
    const newConfig = JSON.parse(await readFile(configPath, 'utf-8'));
    originalConfig.routes.unshift(...newConfig.routes);
    await writeFile(configPath, JSON.stringify(originalConfig, null, 2));
  }
}

export class LocalBuilder extends BaseBuilder {
  #outDir: string;
  constructor(nitro: Nitro, loadedConfig: LoadedWorkflowConfig) {
    const outDir = join(nitro.options.buildDir, 'workflow');
    super({
      ...createNitroBuilderConfig(nitro, loadedConfig),
      watch: nitro.options.dev,
      buildTarget: 'next', // Placeholder, not actually used
    });
    this.#outDir = outDir;
  }

  // Serialize concurrent build() calls so overlapping dev rebuilds don't
  // stomp on each other's temp files or partially overwrite output.
  #buildQueue: Promise<void> = Promise.resolve();

  override build(): Promise<void> {
    const next = this.#buildQueue.then(
      () => this.#buildOnce(),
      () => this.#buildOnce()
    );
    // Swallow rejections on the queue itself so a failed build doesn't
    // permanently reject all subsequent builds; each caller still sees
    // its own rejection via the returned promise.
    this.#buildQueue = next.catch(() => {});
    return next;
  }

  async #buildOnce(): Promise<void> {
    const inputFiles = await this.getInputFiles();
    await mkdir(this.#outDir, { recursive: true });

    // V2: The combined bundle's flow route references the steps file by
    // name in its import statement, so we build directly to final names.
    // (The V1 atomic tmp-file pattern doesn't work here because renaming
    // the steps file would leave the flow route's import stale.)
    const { manifest } = await this.createCombinedBundle({
      inputFiles,
      stepsOutfile: join(this.#outDir, 'steps.mjs'),
      flowOutfile: join(this.#outDir, 'workflows.mjs'),
      format: 'esm',
      // bundleFinalOutput: false — Nitro externalizes the workflow build dir
      // during dev, and its own rollup pipeline handles bundling for prod.
      // Using true causes "Dynamic require of X is not supported" errors
      // because esbuild wraps CJS require() calls in ESM output.
      bundleFinalOutput: false,
      externalizeNonSteps: true,
      // In dev, Nitro dynamically imports the generated workflow files from
      // disk, so there is no later Rollup pass to resolve externalized local
      // TypeScript imports. In prod, Nitro/Rollup handles those imports.
      bundleTransitiveLocalStepDependencies: this.config.watch,
    });

    await this.createWebhookBundle({
      outfile: join(this.#outDir, 'webhook.mjs'),
      bundle: false,
    });

    // Generate manifest
    const workflowBundlePath = join(this.#outDir, 'workflows.mjs');
    await this.createManifest({
      workflowBundlePath,
      manifestDir: this.#outDir,
      manifest,
    });
  }
}
