# @workflow/world

Core interfaces and types for Workflow SDK storage backends.

This package defines the `World` interface that abstracts workflow storage, queuing, authentication, and streaming operations. Implementation packages like `@workflow/world-local` and `@workflow/world-vercel` provide concrete implementations.

Application code usually imports a World implementation package. World packages
implement the `World` interface exported here.
