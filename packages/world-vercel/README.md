# @workflow/world-vercel

Production workflow backend for Vercel platform deployments.

Integrates with Vercel's infrastructure for storage, queuing, and authentication. Handles workflow persistence and scaling in production environments.

Used by default for deployments on Vercel. Authentication and API endpoints are configured automatically in Vercel deployments.

## workflow.config.ts

Use `vercelWorld()` to select the Vercel backend explicitly:

```ts
import { defineConfig } from 'workflow/config';
import { vercelWorld } from '@workflow/world-vercel';

export default defineConfig({
  world: vercelWorld(),
});
```

## Custom dispatcher

HTTP requests (including the queue) default to a shared undici `RetryAgent` that handles connection pooling and retries. Pass a custom `dispatcher` to override it — e.g. to tune undici on newer Node runtimes:

```ts
import { Agent } from 'undici';
import { createVercelWorld } from '@workflow/world-vercel';
import { setWorld } from '@workflow/core/runtime';

setWorld(createVercelWorld({ dispatcher: new Agent({ connections: 16 }) }));
```
