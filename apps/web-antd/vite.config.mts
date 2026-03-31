import type { Plugin } from 'vite';

import process from 'node:process';

import { defineConfig } from '@vben/vite-config';

import electron from 'vite-plugin-electron/simple';
import { loadEnv as loadViteEnv } from 'vite';

/**
 * Inject __dirname / __filename / require polyfill into ESM electron main process output.
 * Many third-party dependencies use bare `require()` which is not available in ESM scope.
 */
function esmDirnamePlugin(): Plugin {
  return {
    name: 'inject-esm-dirname',
    apply: 'build',
    generateBundle(_options, bundle) {
      const polyfill = [
        `import { fileURLToPath as _gftu } from 'node:url';`,
        `import { dirname as _gdn } from 'node:path';`,
        `import { createRequire as _gcr } from 'node:module';`,
        `const __filename = _gftu(import.meta.url);`,
        `const __dirname = _gdn(__filename);`,
        `const require = _gcr(import.meta.url);`,
        '',
      ].join('\n');

      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.fileName.endsWith('.js')) {
          chunk.code = polyfill + chunk.code;
        }
      }
    },
  };
}

const AUTOMATION_EXTERNAL_PACKAGES = [
  'playwright',
  'playwright-core',
  'chromium-bidi',
];

const isAutomationRuntimeExternal = (id: string) => {
  return AUTOMATION_EXTERNAL_PACKAGES.some((pkg) => {
    return (
      id === pkg ||
      id.startsWith(`${pkg}/`) ||
      id.includes(`/node_modules/${pkg}/`) ||
      id.includes(`\\node_modules\\${pkg}\\`)
    );
  });
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function resolveApiProxyTarget(mode: string) {
  const env = loadViteEnv(mode, process.cwd(), '');
  const apiUrl = `${env.VITE_GLOB_API_URL || ''}`.trim();
  const configuredProxyTarget = `${env.VITE_DEV_PROXY_TARGET || ''}`.trim();

  if (!apiUrl.startsWith('/')) {
    return undefined;
  }

  return configuredProxyTarget ? trimTrailingSlash(configuredProxyTarget) : undefined;
}

export default defineConfig(async (_config) => {
  const isVitest = process.env.VITEST === 'true';
  const proxyTarget = resolveApiProxyTarget(_config?.mode || 'development');

  return {
    application: {},
    // @ts-ignore: Fix type mismatch
    vite: {
      base: './',
      build: {
        target: 'esnext' as any,
        rollupOptions: {
          external: (id) => {
            if (
              [
                'core-js',
                'electron',
                'exceljs',
                'node:buffer',
                'node:fs',
                'node:path',
                'node:process',
                'node:url',
                // 确保这些模块不被打包
                'regenerator-runtime',
                'xlsx',
              ].includes(id)
            ) {
              return true;
            }

            return isAutomationRuntimeExternal(id);
          },
          output: {
            manualChunks: (id) => {
              if (id.includes('node_modules')) {
                return 'vendor';
              }
            },
          },
        },
        commonjsOptions: {
          ignore: ['exceljs', 'xlsx'],
        },
      },
      optimizeDeps: {
        exclude: ['electron'],
        include: [],
      },
      plugins: isVitest
        ? []
        : [
            await electron({
              main: {
                entry: 'electron/main.ts',
                vite: {
                  plugins: [esmDirnamePlugin()],
                  build: {
                    rollupOptions: {
                      external: (id) => isAutomationRuntimeExternal(id),
                    },
                  },
                },
              },
              preload: {
                input: 'electron/preload.ts',
              },
              renderer: {},
            }),
          ],
      server: {
        proxy: proxyTarget
          ? {
              '/api': {
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
                target: proxyTarget,
                ws: true,
              },
            }
          : undefined,
      },
    },
  };
});
