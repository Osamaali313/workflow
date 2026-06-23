import { expect, it } from 'vitest';
import { VercelBuildOutputAPIBuilder } from './vercel-build-output-api.js';

it('rejects external packages because the target does not trace them', async () => {
  const builder = new VercelBuildOutputAPIBuilder({
    buildTarget: 'vercel-build-output-api',
    dirs: ['.'],
    workingDir: process.cwd(),
    externalPackages: ['database-client'],
    stepsBundlePath: '',
    workflowsBundlePath: '',
    webhookBundlePath: '',
  });

  await expect(builder.build()).rejects.toThrow(
    'build.externalPackages is not supported by the vercel-build-output-api target.'
  );
});
