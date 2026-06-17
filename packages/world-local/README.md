# @workflow/world-local

Filesystem-based workflow backend for local development and testing.

Stores workflow data as JSON files on disk and provides in-memory queuing. Automatically detects development server port for queue transport.

Used by default on `next dev` and `next start`.

## workflow.config.ts

Use `localWorld()` in `workflow.config.ts`:

```ts
import { defineConfig } from 'workflow/config';
import { localWorld } from '@workflow/world-local';

export default defineConfig({
  world: localWorld({
    dataDir: '.workflow-data',
    port: 3000,
  }),
});
```
