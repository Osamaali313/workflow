import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkflowEntrypointOptionsCode,
  createWorkflowQueueTrigger,
} from './constants.js';

describe('createWorkflowQueueTrigger', () => {
  afterEach(() => {
    delete process.env.WORKFLOW_QUEUE_NAMESPACE;
  });

  it('uses the default workflow topic without a namespace', () => {
    expect(createWorkflowQueueTrigger().topic).toBe('__wkf_workflow_*');
  });

  it('uses an explicit namespace when provided', () => {
    expect(createWorkflowQueueTrigger({ namespace: 'custom' }).topic).toBe(
      '__custom_wkf_workflow_*'
    );
  });

  it('uses WORKFLOW_QUEUE_NAMESPACE when no explicit namespace is provided', () => {
    process.env.WORKFLOW_QUEUE_NAMESPACE = 'custom';

    expect(createWorkflowQueueTrigger().topic).toBe('__custom_wkf_workflow_*');
  });
});

describe('createWorkflowEntrypointOptionsCode', () => {
  afterEach(() => {
    delete process.env.WORKFLOW_QUEUE_NAMESPACE;
  });

  it('omits options without values', () => {
    expect(createWorkflowEntrypointOptionsCode()).toBe('');
  });

  it('inlines an explicit namespace', () => {
    expect(createWorkflowEntrypointOptionsCode({ namespace: 'custom' })).toBe(
      ', { namespace: "custom" }'
    );
  });

  it('inlines WORKFLOW_QUEUE_NAMESPACE at build time', () => {
    process.env.WORKFLOW_QUEUE_NAMESPACE = 'custom';

    expect(createWorkflowEntrypointOptionsCode()).toBe(
      ', { namespace: "custom" }'
    );
  });

  it('inlines route module timing with namespace options', () => {
    expect(
      createWorkflowEntrypointOptionsCode({
        namespace: 'custom',
        routeModuleBodyStartedAt: 'workflowRouteModuleBodyStartedAt',
      })
    ).toBe(
      ', { namespace: "custom", routeModuleBodyStartedAt: workflowRouteModuleBodyStartedAt }'
    );
  });

  it('inlines runtime options', () => {
    expect(
      createWorkflowEntrypointOptionsCode({
        runtime: {
          replayTimeoutMs: 300_000,
          inlineExecutionTimeoutMs: 90_000,
        },
      })
    ).toBe(
      ', { runtime: { replayTimeoutMs: 300000, inlineExecutionTimeoutMs: 90000 } }'
    );
  });
});
