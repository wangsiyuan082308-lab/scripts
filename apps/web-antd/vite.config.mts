import { defineConfig } from '@vben/vite-config';
import electron from 'vite-plugin-electron/simple';
import type { Plugin } from 'vite';

/**
 * Inject __dirname / __filename polyfill into ESM electron main process output.
 * Many feature files use bare `__dirname` which is not available in ESM scope.
 */
function esmDirnamePlugin(): Plugin {
  return {
    name: 'inject-esm-dirname',
    apply: 'build',
    generateBundle(_options, bundle) {
      const polyfill = [
        `import { fileURLToPath as _gftu } from 'node:url';`,
        `import { dirname as _gdn } from 'node:path';`,
        `const __filename = _gftu(import.meta.url);`,
        `const __dirname = _gdn(__filename);`,
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

export default defineConfig(async () => {
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
      plugins: [
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
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // mock代理目标地址（Nitro backend-mock）
            target: 'http://localhost:5320/api',
            ws: true,
          },
        },
      },
    },
  };
});
