import { defineConfig } from '@vben/vite-config';
import electron from 'vite-plugin-electron/simple';

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
