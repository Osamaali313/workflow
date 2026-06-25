# @workflow/world-local

Filesystem-based workflow backend for local development and testing.

Stores workflow data as JSON files on disk and provides in-memory queuing. Automatically detects development server port for queue transport.

Used by default on `next dev` and `next start`.

```ts
import { createWorld } from '@workflow/world-local';

const world = createWorld({
  dataDir: '.workflow-data',
  port: 3000,
  queueConcurrency: 50,
  maxQueueVisibilitySeconds: 300,
});
```

Options override the corresponding `WORKFLOW_LOCAL_*` environment variables.
