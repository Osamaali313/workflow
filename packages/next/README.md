# @workflow/next

Next.js plugin for [Workflow SDK](https://workflow-sdk.dev).

Shared build, World, queue, and Next-specific settings can live in
`workflow.config.ts`:

```ts
import { defineConfig } from 'workflow/config';
import { localWorld } from '@workflow/world-local';

export default defineConfig({
  world: localWorld(),
  build: { sourcemap: false },
  integration: {
    type: 'next',
    lazyDiscovery: true,
  },
});
```

Wrap `next.config.ts` with `withWorkflow()` to activate directive transforms.
Values passed in its optional second argument take precedence over environment
variables and `workflow.config.ts`.
