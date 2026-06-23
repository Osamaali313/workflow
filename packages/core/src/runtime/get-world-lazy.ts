/**
 * Lazy accessor for the World singleton via globalThis symbols.
 *
 * This module exists to break the static import chain from step-side
 * modules (serialization, run, helpers, start) to world.ts. Without it,
 * esbuild bundles world.ts (and its transitive deps: world-local,
 * world-vercel, process.cwd(), etc.) into the step registrations bundle,
 * which triggers Turbopack NFT tracing errors in the V2 combined flow route.
 *
 * Resolution order, in priority:
 *
 * 1. `globalThis[GetWorldFnKey]` — populated by the module-load side
 *    effect at the bottom of `./world.ts`. Fires on every server bundle
 *    that reaches this file via `workflow/api` (which imports
 *    `./world-init.ts` for its side effect; see that file for the full
 *    rationale).
 * 2. The global World cache or pending creation promise when world.ts is not
 *    present in the bundle.
 * 3. Dynamic `import('./world.js')` — last-resort fallback for
 *    environments where neither (1) nor (2) is available (CJS test
 *    runners, scripts that import deeply into `@workflow/core` without
 *    going through `workflow/api`, future bundlers we haven't validated).
 *    The specifier is built at runtime so esbuild can't trace it into
 *    step bundles. Note: this branch is unreliable in webpack-bundled
 *    routes because webpack inlines this module into the route file and
 *    the relative path resolves against the bundle location — paths (1)
 *    and (2) cover those cases instead.
 */

import type { World } from '@workflow/world';

const WorldCacheKey = Symbol.for('@workflow/world//cache');
const WorldCachePromiseKey = Symbol.for('@workflow/world//cachePromise');
const GetWorldFnKey = Symbol.for('@workflow/world//getWorldFn');

export async function getWorldLazy(): Promise<World> {
  const g = globalThis as any;
  const getWorldFn = g[GetWorldFnKey] as (() => Promise<World>) | undefined;
  if (getWorldFn) return getWorldFn();
  if (g[WorldCacheKey]) return g[WorldCacheKey];
  if (g[WorldCachePromiseKey]) {
    const pendingWorld = g[WorldCachePromiseKey];
    const world = await pendingWorld;
    if (g[WorldCachePromiseKey] === pendingWorld) {
      g[WorldCacheKey] = world;
    }
    return world;
  }
  // Last resort: dynamic import for environments where world.ts wasn't
  // bundled but is reachable as a sibling module on disk. The specifier is
  // built at runtime so esbuild can't trace it into the step bundle.
  const worldPath = ['./world', 'js'].join('.');
  const { getWorld } = await import(worldPath);
  return getWorld();
}
