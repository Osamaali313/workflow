# @workflow/world-local

Filesystem-based workflow backend for local development and testing.

Stores workflow data as JSON files on disk and provides in-memory queuing. Automatically detects development server port for queue transport.

Used by default on `next dev` and `next start`.

## workflow.config.ts

Use `createLocalWorld()` in `workflow.config.ts`:

```ts
import type { WorkflowConfig } from 'workflow/config';
import { createLocalWorld } from '@workflow/world-local';

const config: WorkflowConfig = {
  world: () => createLocalWorld({
    dataDir: '.workflow-data',
    port: 3000,
  }),
};

export default config;
```
