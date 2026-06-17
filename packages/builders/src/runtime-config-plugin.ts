import type { Plugin } from 'esbuild';

export function createRuntimeConfigPlugin(runtimeConfigPath: string): Plugin {
  return {
    name: 'workflow-runtime-config',
    setup(build) {
      build.onResolve(
        { filter: /^@workflow\/config\/runtime-binding$/ },
        () => ({
          path: runtimeConfigPath,
        })
      );
    },
  };
}
