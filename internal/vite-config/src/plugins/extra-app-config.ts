import type { PluginOption } from 'vite';

import {
  colors,
  generatorContentHash,
  readPackageJSON,
} from '@vben/node-utils';

import { loadEnv } from '../utils/env';

interface PluginOptions {
  isBuild: boolean;
  root: string;
}

const GLOBAL_CONFIG_FILE_NAME = '_app.config.js';
const VBEN_ADMIN_PRO_APP_CONF = '_VBEN_ADMIN_PRO_APP_CONF_';

/**
 * 用于将配置文件抽离出来并注入到项目中
 * @returns
 */

async function viteExtraAppConfigPlugin({
  isBuild,
  root,
}: PluginOptions): Promise<PluginOption | undefined> {
  let publicPath: string;
  let source: string;

  if (!isBuild) {
    return;
  }

  const { version = '' } = await readPackageJSON(root);

  return {
    async configResolved(config) {
      publicPath = ensureTrailingSlash(config.base);
      source = await getConfigSource();
    },
    async generateBundle() {
      try {
        this.emitFile({
          fileName: GLOBAL_CONFIG_FILE_NAME,
          source,
          type: 'asset',
        });

        console.log(colors.cyan(`✨configuration file is build successfully!`));
      } catch (error) {
        console.log(
          colors.red(
            `configuration file configuration file failed to package:\n${error}`,
          ),
        );
      }
    },
    name: 'vite:extra-app-config',
    async transformIndexHtml(html) {
      // Electron 使用 file:// 加载 index.html 时，部分环境会对本地脚本 query 参数解析不稳定，
      // 导致 _app.config.js 未执行，进而应用卡在启动 loading。
      // 这里移除 query hash，确保本地文件路径可稳定加载。
      const _hash = `v=${version}-${generatorContentHash(source, 8)}`;
      void _hash;
      const appConfigSrc = `${publicPath}${GLOBAL_CONFIG_FILE_NAME}`;

      return {
        html,
        tags: [{ attrs: { src: appConfigSrc }, tag: 'script' }],
      };
    },
  };
}

async function getConfigSource() {
  const config = await loadEnv();
  const windowVariable = `window.${VBEN_ADMIN_PRO_APP_CONF}`;
  // 确保变量不会被修改
  let source = `${windowVariable}=${JSON.stringify(config)};`;
  source += `
    Object.freeze(${windowVariable});
    Object.defineProperty(window, "${VBEN_ADMIN_PRO_APP_CONF}", {
      configurable: false,
      writable: false,
    });
  `.replaceAll(/\s/g, '');
  return source;
}

function ensureTrailingSlash(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

export { viteExtraAppConfigPlugin };
