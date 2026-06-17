import {
  type DynamicModule,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createBuildQueue } from '@workflow/builders';
import { loadWorkflowConfig } from '@workflow/config/load';
import { setRuntimeWorkflowConfig } from '@workflow/config/runtime';
import { closeWorld } from '@workflow/core/runtime';
import { type NestBuilderOptions, NestLocalBuilder } from './builder.js';
import {
  configureWorkflowController,
  WorkflowController,
} from './workflow.controller.js';

export interface WorkflowModuleOptions extends NestBuilderOptions {
  /**
   * Skip building workflow bundles (useful in production when bundles are pre-built)
   * @default false
   */
  skipBuild?: boolean;
}

/**
 * NestJS module that provides workflow functionality.
 * Builds workflow bundles on module initialization and registers the workflow controller.
 */
@Module({})
export class WorkflowModule implements OnModuleInit, OnModuleDestroy {
  private static buildQueue = createBuildQueue();

  constructor(
    @Inject('WORKFLOW_OPTIONS')
    private readonly options: WorkflowModuleOptions
  ) {}

  /**
   * Configure the WorkflowModule with options.
   * Call this in your AppModule imports.
   *
   * @example
   * ```typescript
   * @Module({
   *   imports: [WorkflowModule.forRoot()],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: WorkflowModuleOptions = {}): DynamicModule {
    return {
      module: WorkflowModule,
      controllers: [WorkflowController],
      providers: [
        {
          provide: 'WORKFLOW_OPTIONS',
          useValue: options,
        },
      ],
      global: true,
    };
  }

  async onModuleInit() {
    const { workingDir = process.cwd() } = this.options;
    const workflowConfig = await loadWorkflowConfig({
      cwd: workingDir,
      integration: 'nest',
    });
    const config = workflowConfig.config;
    const integration =
      config.integration?.type === 'nest' ? config.integration : undefined;
    const builder = new NestLocalBuilder({
      ...this.options,
      workflowConfig,
    });

    setRuntimeWorkflowConfig(config);

    const publicManifest =
      process.env.WORKFLOW_PUBLIC_MANIFEST === undefined
        ? (config.build?.manifest?.public ?? false)
        : process.env.WORKFLOW_PUBLIC_MANIFEST === '1';
    configureWorkflowController(builder.outDir, publicManifest);
    if (this.options.skipBuild ?? integration?.skipBuild) return;

    await WorkflowModule.buildQueue(() => builder.build());
  }

  async onModuleDestroy() {
    await closeWorld();
    setRuntimeWorkflowConfig(undefined);
  }
}
