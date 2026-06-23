import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getRuntimeWorkflowConfig } from '@workflow/config/runtime';
import boundWorkflowConfig from '@workflow/config/runtime-binding';
import {
  isVercelWorldTarget,
  resolveWorkflowTargetWorld,
} from '@workflow/utils';
import type { World } from '@workflow/world';
import { setWorkflowQueueNamespace } from '@workflow/world/queue.js';
import { createLocalWorld } from '@workflow/world-local';
import { createVercelWorld } from '@workflow/world-vercel';

function getRuntimeRequire() {
  // Resolve from the app root (process.cwd()) so custom world packages
  // like @workflow/world-postgres can be found even though they're not
  // dependencies of @workflow/core. Using import.meta.url would resolve
  // from core's location, missing app-level packages.
  try {
    return createRequire(pathToFileURL(`${process.cwd()}/package.json`).href);
  } catch {
    return createRequire(import.meta.url);
  }
}

const WorldCache = Symbol.for('@workflow/world//cache');
const WorldCachePromise = Symbol.for('@workflow/world//cachePromise');
const ManagedWorldCache = Symbol.for('@workflow/world//managedCache');
const ManagedWorldCachePromise = Symbol.for(
  '@workflow/world//managedCachePromise'
);

const globalSymbols: typeof globalThis & {
  [WorldCache]?: World;
  [WorldCachePromise]?: Promise<World>;
  [ManagedWorldCache]?: boolean;
  [ManagedWorldCachePromise]?: boolean;
} = globalThis;

function getWorkflowConfig() {
  return boundWorkflowConfig ?? getRuntimeWorkflowConfig() ?? {};
}

setWorkflowQueueNamespace(getWorkflowConfig().queue?.namespace);

// Dynamic import for custom world modules. Uses a standard import()
// wrapped in a try/catch with require() fallback for CJS test runners.
// Note: the previous `new Function('specifier', 'return import(specifier)')`
// pattern was replaced because Turbopack (Next.js) treats unresolvable
// dynamic imports from `new Function` as fatal build errors in the V2
// combined flow route context.

function resolveModulePath(specifier: string): string {
  // Already a file:// URL
  if (specifier.startsWith('file://')) {
    return specifier;
  }
  // Absolute path - convert to file:// URL
  if (specifier.startsWith('/')) {
    return pathToFileURL(specifier).href;
  }
  // Relative path - resolve relative to cwd and convert to file:// URL
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(
      /* turbopackIgnore: true */ `${process.cwd()}/${specifier}`
    ).href;
  }
  // Package specifier - use require.resolve to find the package
  try {
    return pathToFileURL(getRuntimeRequire().resolve(specifier)).href;
  } catch {
    return specifier;
  }
}

/**
 * Create a new world instance based on environment variables.
 * WORKFLOW_TARGET_WORLD is used to determine the target world.
 *
 * Note: WORKFLOW_VERCEL_* env vars (PROJECT, TEAM, AUTH_TOKEN, etc.) are
 * intentionally NOT read here. Those are for CLI/observability tooling only
 * and should not affect runtime behavior. The Vercel runtime provides
 * authentication via OIDC tokens and project context via system env vars
 * (VERCEL_DEPLOYMENT_ID, VERCEL_PROJECT_ID). Tooling that needs these env
 * vars should call createVercelWorld() directly with an explicit config and
 * use setWorld() to inject the instance.
 */
async function createLegacyWorld(): Promise<World> {
  const targetWorld = resolveWorkflowTargetWorld();

  if (isVercelWorldTarget(targetWorld)) {
    // Warn if WORKFLOW_VERCEL_* env vars are set inside a Vercel serverless
    // function (VERCEL=1) — they have no effect at runtime and likely indicate
    // a misconfiguration (user manually added them as Vercel project env vars,
    // which is not needed). We gate on VERCEL=1 so the warning does not fire
    // when the CLI or web observability app sets these env vars intentionally.
    const staleEnvVars = [
      'WORKFLOW_VERCEL_PROJECT',
      'WORKFLOW_VERCEL_TEAM',
      'WORKFLOW_VERCEL_AUTH_TOKEN',
      'WORKFLOW_VERCEL_ENV',
    ].filter((key) => process.env[key]);
    if (staleEnvVars.length > 0 && process.env.VERCEL === '1') {
      console.warn(
        `[workflow] Warning: ${staleEnvVars.join(', ')} env var(s) ` +
          'are set but have no effect at runtime. These are only used by the Workflow CLI. ' +
          'Remove them from your Vercel project environment variables.'
      );
    }

    return createVercelWorld();
  }

  if (targetWorld === 'local') {
    return createLocalWorld({
      dataDir: process.env.WORKFLOW_LOCAL_DATA_DIR,
    });
  }

  // Try require() first for custom worlds — this avoids Turbopack tracing
  // a dynamic import() that it can't statically resolve. Fall back to
  // dynamic import() for ESM-only packages.
  let mod: any;
  try {
    mod = getRuntimeRequire()(targetWorld);
  } catch {
    const resolvedPath = resolveModulePath(targetWorld);
    mod = await import(/* webpackIgnore: true */ resolvedPath);
  }
  if (typeof mod === 'function') {
    return mod() as World;
  } else if (typeof mod.default === 'function') {
    return mod.default() as World;
  } else if (typeof mod.createWorld === 'function') {
    return mod.createWorld() as World;
  }

  throw new Error(
    `Invalid target world module: ${targetWorld}, must export a default function or createWorld function that returns a World instance.`
  );
}

type ResolvedWorld =
  | { type: 'configured'; world: World }
  | { type: 'legacy'; world: World };

async function resolveWorld(): Promise<ResolvedWorld> {
  const config = getWorkflowConfig();

  if (process.env.WORKFLOW_TARGET_WORLD) {
    return {
      type: 'legacy',
      world: await createLegacyWorld(),
    };
  }

  if (config.world) {
    const world = await config.world();
    assert(world, 'Configured World provider must return a World.');
    return {
      type: 'configured',
      world,
    };
  }

  return {
    type: 'legacy',
    world: await createLegacyWorld(),
  };
}

/**
 * Create a new World instance from WORKFLOW_TARGET_WORLD when set, then
 * workflow.config.ts, then the environment-aware default.
 *
 * This function does not call World.start(). Use getWorld() for the managed
 * runtime singleton.
 */
export const createWorld = async (): Promise<World> => {
  return (await resolveWorld()).world;
};

export type WorldHandlers = Pick<World, 'createQueueHandler' | 'specVersion'>;

/**
 * Queue handlers and regular runtime calls share one managed World. The World
 * factory is never called by config loading or the build integrations; this
 * path is reached only when host runtime code asks for a handler.
 */
export const getWorldHandlers = async (): Promise<WorldHandlers> => {
  const world = await getWorld();
  return {
    createQueueHandler: world.createQueueHandler,
    specVersion: world.specVersion,
  };
};

export const getWorld = async (): Promise<World> => {
  if (globalSymbols[WorldCache]) {
    return globalSymbols[WorldCache];
  }

  let pendingWorld = globalSymbols[WorldCachePromise];
  if (!pendingWorld) {
    globalSymbols[ManagedWorldCachePromise] =
      !process.env.WORKFLOW_TARGET_WORLD && !!getWorkflowConfig().world;
    pendingWorld = resolveWorld().then(async (resolved) => {
      switch (resolved.type) {
        case 'configured':
          try {
            await resolved.world.start?.();
          } catch (error) {
            await resolved.world.close?.();
            throw error;
          }
          return resolved.world;
        case 'legacy':
          return resolved.world;
        default:
          resolved satisfies never;
          throw new Error('Unknown World resolution type');
      }
    });
    globalSymbols[WorldCachePromise] = pendingWorld;
  }
  const pendingWorldIsManaged =
    globalSymbols[ManagedWorldCachePromise] ?? false;

  try {
    const world = await pendingWorld;
    if (globalSymbols[WorldCachePromise] === pendingWorld) {
      globalSymbols[WorldCache] = world;
      globalSymbols[ManagedWorldCache] = pendingWorldIsManaged;
      globalSymbols[WorldCachePromise] = undefined;
      globalSymbols[ManagedWorldCachePromise] = undefined;
    }
    return world;
  } catch (error) {
    if (globalSymbols[WorldCachePromise] === pendingWorld) {
      globalSymbols[WorldCachePromise] = undefined;
      globalSymbols[ManagedWorldCachePromise] = undefined;
    }
    throw error;
  }
};

/** Override or clear an unmanaged cached World. */
export const setWorld = (world: World | undefined): void => {
  assert(
    !globalSymbols[ManagedWorldCache] &&
      !globalSymbols[ManagedWorldCachePromise],
    'Call await closeWorld() before replacing a managed World.'
  );

  globalSymbols[WorldCache] = world;
  globalSymbols[WorldCachePromise] = undefined;
  globalSymbols[ManagedWorldCache] = undefined;
  globalSymbols[ManagedWorldCachePromise] = undefined;
};

/**
 * Close the cached World without creating one just for cleanup.
 */
export const closeWorld = async (): Promise<void> => {
  const cachedWorld = globalSymbols[WorldCache];
  const pendingWorld = globalSymbols[WorldCachePromise];

  globalSymbols[WorldCache] = undefined;
  globalSymbols[WorldCachePromise] = undefined;
  globalSymbols[ManagedWorldCache] = undefined;
  globalSymbols[ManagedWorldCachePromise] = undefined;

  const world = cachedWorld ?? (pendingWorld ? await pendingWorld : undefined);
  await world?.close?.();
};

// Register getWorld on globalThis so getWorldLazy can call it directly when
// world.ts is statically present in the bundle. This avoids the relative
// dynamic import('./world.js') fallback in get-world-lazy.ts, which fails
// after Next.js inlines get-world-lazy.js into a route bundle (no sibling
// world.js exists at the bundled location).
//
// For server routes that only consume `start` (or another helper that goes
// through getWorldLazy without statically using getWorld), webpack/turbopack
// would otherwise tree-shake world.ts out of the bundle entirely. The
// host-only `./world-init.ts` module imports world.ts for its side effect
// and is itself imported by `packages/workflow/src/api.ts` so this
// registration runs in every server bundle that touches `workflow/api`.
//
// Step/VM bundles never reach this branch: they don't statically import
// world.ts, and `world-init` resolves to an empty stub via the `workflow`
// export condition.
const GetWorldFnKey = Symbol.for('@workflow/world//getWorldFn');
(globalThis as { [GetWorldFnKey]?: () => Promise<World> })[GetWorldFnKey] ??=
  getWorld;
