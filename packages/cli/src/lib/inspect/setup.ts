import { loadWorldProvider } from '@workflow/builders/workflow-config';
import { getWorld, setWorld } from '@workflow/core/runtime';
import { isVercelWorldTarget } from '@workflow/utils';
import { createVercelWorld } from '@workflow/world-vercel';
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import { logger, setJsonMode, setVerboseMode } from '../config/log.js';
import { loadProjectWorkflowConfig } from '../config/workflow-config.js';
import { checkForUpdateCached } from '../update-check.js';
import {
  inferLocalWorldEnvVars,
  inferVercelEnvVars,
  type VercelEnvVars,
  writeEnvVars,
} from './env.js';

/** Set up the CLI World, allowing the web UI to ignore missing local data. */
export const setupCliWorld = async (
  flags: {
    json: boolean;
    verbose: boolean;
    backend?: string;
    env?: string;
    authToken?: string;
    project?: string;
    team?: string;
    port?: number;
  },
  version: string,
  ignoreLocalWorldConfigError = false
) => {
  setJsonMode(Boolean(flags.json));
  setVerboseMode(Boolean(flags.verbose));

  const loadedConfig = await loadProjectWorkflowConfig();
  const configured =
    !flags.backend &&
    !process.env.WORKFLOW_TARGET_WORLD &&
    !!loadedConfig.worldModule;

  const backend =
    flags.backend ??
    process.env.WORKFLOW_TARGET_WORLD ??
    (configured
      ? 'configured'
      : process.env.VERCEL_DEPLOYMENT_ID
        ? 'vercel'
        : 'local');

  // Check for updates
  const updateCheck = await checkForUpdateCached(version);

  const withAnsiLinks = !flags.json;
  const docsUrl = withAnsiLinks
    ? terminalLink('https://workflow-sdk.dev/', 'https://workflow-sdk.dev/')
    : 'https://workflow-sdk.dev/';

  // Prepare showBox lines
  const boxLines = [
    `Workflow CLI v${version}`,
    `Docs at ${docsUrl}`,
    chalk.yellow('This is a beta release'),
  ];

  // Add update message if available
  if (updateCheck.needsUpdate && updateCheck.latestVersion) {
    boxLines.push(
      '',
      chalk.cyan(
        `Update available: ${updateCheck.currentVersion} → ${updateCheck.latestVersion}`
      ),
      // Note that we're suggesting install "latest" instead of the release tag that the user is
      // on, because we currently tag beta releases as "latest". After GA, we need to adjust
      // this to install the release tag that the user is on.
      chalk.gray(
        `Run: \`[npm|bun|pnpm] i workflow@${updateCheck.latestVersion}\``
      ),
      chalk.gray(
        terminalLink(
          'View changelog',
          'https://github.com/vercel/workflow/releases'
        )
      )
    );
  }

  logger.showBox('green', ...boxLines);

  logger.debug(
    'Inferring env vars, backend:',
    backend ?? loadedConfig.config.world
  );
  writeEnvVars({
    DEBUG: flags.verbose ? '1' : '',
    WORKFLOW_TARGET_WORLD: backend,
  });

  let vercelEnvVars: VercelEnvVars | undefined;
  if (backend && isVercelWorldTarget(backend)) {
    // Seed the initial flags into process.env so inferVercelEnvVars() can
    // read them via getEnvVars() as starting values before inference.
    writeEnvVars({
      WORKFLOW_VERCEL_ENV:
        flags.env ?? process.env.WORKFLOW_VERCEL_ENV ?? 'production',
      WORKFLOW_VERCEL_AUTH_TOKEN: flags.authToken,
      WORKFLOW_VERCEL_PROJECT: flags.project,
      WORKFLOW_VERCEL_TEAM: flags.team,
    });
    vercelEnvVars = await inferVercelEnvVars();
  } else if (backend === 'local' || backend === '@workflow/world-local') {
    if (flags.port) {
      writeEnvVars({
        WORKFLOW_LOCAL_BASE_URL: `http://localhost:${flags.port}`,
      });
    }
    try {
      await inferLocalWorldEnvVars();
    } catch (error) {
      if (ignoreLocalWorldConfigError) {
        const configError =
          error instanceof Error
            ? error.message
            : 'Unknown configuration error';
        logger.warn(
          'Failed to find valid local world configuration:',
          configError
        );
        return null;
      }
      throw error;
    }
  }

  logger.debug('Initializing world');

  if (vercelEnvVars) {
    // Build the Vercel world directly from the inferred config, rather than
    // relying on createWorld() reading process.env.
    const world = createVercelWorld({
      token: vercelEnvVars.token,
      projectConfig: {
        environment: vercelEnvVars.environment,
        projectId: vercelEnvVars.projectId,
        projectName: vercelEnvVars.projectName,
        teamId: vercelEnvVars.teamId,
      },
    });
    setWorld(world);
    return world;
  }

  if (configured && loadedConfig.worldModule) {
    const worldProvider = await loadWorldProvider(loadedConfig.worldModule);
    const world = await worldProvider();
    await world.start?.();
    setWorld(world);
    return world;
  }

  return getWorld();
};
