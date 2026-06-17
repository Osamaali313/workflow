# @workflow/world

Core interfaces and types for Workflow SDK storage backends.

This package defines the `World` interface that abstracts workflow storage, queuing, authentication, and streaming operations. Implementation packages like `@workflow/world-local` and `@workflow/world-vercel` provide concrete implementations.

It also defines the `WorldProvider` contract used by `workflow.config.ts`.

Custom World packages can expose a typed helper with `defineWorldProvider()`:

<!-- @skip-typecheck: conceptual custom provider package example -->

```ts
import { defineWorldProvider } from '@workflow/world';

export function hybridWorld(options: HybridOptions) {
  return defineWorldProvider({
    create: () => createHybridWorld(options),
  });
}
```

Most applications should use a provider helper from a World implementation
instead of importing this package directly.
