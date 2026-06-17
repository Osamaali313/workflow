# @workflow/next

Next.js plugin for [Workflow SDK](https://workflow-sdk.dev).

Shared build, World, queue, and Next-specific settings can live in
`workflow.config.ts`:

```ts
import type { WorkflowConfig } from 'workflow/config';
import { createLocalWorld } from '@workflow/world-local';

const config: WorkflowConfig = {
  world: createLocalWorld,
  build: { sourcemap: false },
  integration: {
    type: 'next',
    lazyDiscovery: true,
  },
};

export default config;
```

Wrap `next.config.ts` with `withWorkflow()` to activate directive transforms.
Values passed in its optional second argument take precedence over environment
variables and `workflow.config.ts`.
