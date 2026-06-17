# @workflow/config

Typed, shared configuration for Workflow SDK.

Import it through `workflow/config`:

```ts
import type { WorkflowConfig } from 'workflow/config';
import { createWorld } from '@workflow/world-postgres';

const config: WorkflowConfig = {
  world: createWorld,
  build: {
    dirs: ['workflows'],
    sourcemap: false,
  },
  integration: {
    type: 'next',
    lazyDiscovery: true,
  },
};

export default config;
```

See the [configuration guide](https://workflow-sdk.dev/v5/docs/foundations/configuration)
for the available settings.
