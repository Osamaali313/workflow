# @workflow/config

Typed, shared configuration for Workflow SDK.

Import it through `workflow/config`:

```ts
import { defineConfig } from 'workflow/config';
import { postgresWorld } from '@workflow/world-postgres';

export default defineConfig({
  world: postgresWorld({
    connectionString: () => process.env.WORKFLOW_POSTGRES_URL!,
  }),
  build: {
    dirs: ['workflows'],
    sourcemap: false,
  },
  integration: {
    type: 'next',
    lazyDiscovery: true,
  },
});
```

See the [configuration guide](https://workflow-sdk.dev/docs/foundations/configuration)
for the available settings.
