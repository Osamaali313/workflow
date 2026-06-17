import {
  type DynamicModule,
  Inject,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import { createBuildQueue } from '@workflow/builders';
import { loadWorkflowConfig } from '@workflow/config/load';
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
export class WorkflowModule implements OnModuleInit {
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
    const integration = workflowConfig.config.integration;
    const builder = new NestLocalBuilder({
      ...this.options,
      workflowConfig,
    });

    configureWorkflowController(builder.outDir);
    if (
      this.options.skipBuild ??
      (integration?.type === 'nest' ? integration.skipBuild : false)
    )
      return;

    await WorkflowModule.buildQueue(() => builder.build());
  }
}
