import { defineConfig } from '@vben/vite-config';
import electron from 'vite-plugin-electron/simple';
import type { Plugin } from 'vite';
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

const AUTOMATION_EXTERNAL_PACKAGES = ['playwright', 'playwright-core', 'chromium-bidi'];

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

function createApiProxy(target: string) {
  return {
    changeOrigin: true,
    rewrite: (path: string) => {
      return target.endsWith('/api') ? path.replace(/^\/api/, '') : path;
    },
    target,
    ws: true,
  };
}

function resolveApiProxyTarget(mode: string) {
  const env = loadViteEnv(mode, process.cwd(), '');
  const apiUrl = `${env.VITE_GLOB_API_URL || ''}`.trim();
  const mockEnabled = `${env.VITE_NITRO_MOCK || ''}`.trim() === 'true';
  const configuredProxyTarget = `${env.VITE_DEV_PROXY_TARGET || ''}`.trim();

  if (!apiUrl.startsWith('/')) {
    return undefined;
  }

  if (configuredProxyTarget) {
    return trimTrailingSlash(configuredProxyTarget);
  }

  if (mockEnabled) {
    return 'http://localhost:5320/api';
  }

  return 'http://120.55.244.232/api';
}

export default defineConfig(async (config) => {
  const isVitest = process.env.VITEST === 'true';
  const isBuild = config?.command === 'build';
  const proxyTarget = resolveApiProxyTarget(config?.mode || 'development');
  const financeProxyTarget = proxyTarget || 'http://120.55.244.232/api';

  return {
    application: {
      nitroMock: !isBuild,
    },
    // @ts-ignore: Fix type mismatch
    vite: {
      base: './',
      build: {
        target: 'esnext' as any,
        rollupOptions: {
          external: (id) => {
            if (
              [
                'exceljs',
                'xlsx',
                'electron',
                'node:fs',
                'node:path',
                'node:buffer',
                'node:process',
                'node:url',
                // 确保这些模块不被打包
                'regenerator-runtime',
                'core-js',
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
        proxy: {
          '/api/finance': createApiProxy(financeProxyTarget),
          '/api/decision': createApiProxy(financeProxyTarget),
          ...(proxyTarget ? { '/api': createApiProxy(proxyTarget) } : {}),
        },
      },
    },
  };
});
