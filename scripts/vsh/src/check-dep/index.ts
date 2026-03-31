import type { CAC } from 'cac';

import {
  colors,
  consola,
  getPackages,
  spinner,
  UNICODE,
} from '@vben/node-utils';

import depcheck from 'depcheck';

// 默认配置
const DEFAULT_CONFIG = {
  // 需要忽略的依赖匹配
  ignoreMatches: [
    'vite',
    'vitest',
    'unbuild',
    '@vben/tsconfig',
    '@vben/vite-config',
    '@vben/tailwind-config',
    '@types/*',
    '@vben-core/design',
  ],
  // 需要忽略的包
  ignorePackages: [
    '@vben/commitlint-config',
    '@vben/eslint-config',
    '@vben/node-utils',
    '@vben/prettier-config',
    '@vben/stylelint-config',
    '@vben/tailwind-config',
    '@vben/tsconfig',
    '@vben/vite-config',
    '@vben/vsh',
  ],
  // 需要忽略的文件模式
  ignorePatterns: ['dist', 'node_modules', 'public'],
};

interface DepcheckResult {
  dependencies: string[];
  devDependencies: string[];
  missing: Record<string, string[]>;
}

interface DepcheckConfig {
  check?: boolean;
  ignoreMatches?: string[];
  ignorePackages?: string[];
  ignorePatterns?: string[];
}

interface PackageInfo {
  dir: string;
  packageJson: {
    name: string;
  };
}

/**
 * 清理依赖检查结果
 * @param unused - 依赖检查结果
 */
function cleanDepcheckResult(unused: DepcheckResult): void {
  // 删除file:前缀的依赖提示，该依赖是本地依赖
  Reflect.deleteProperty(unused.missing, 'file:');

  // 清理路径依赖
  Object.keys(unused.missing).forEach((key) => {
    unused.missing[key] = (unused.missing[key] || []).filter(
      (item: string) => !item.startsWith('/'),
    );
    if (unused.missing[key].length === 0) {
      Reflect.deleteProperty(unused.missing, key);
    }
  });
}

/**
 * 格式化依赖检查结果
 * @param pkgName - 包名
 * @param unused - 依赖检查结果
 */
function formatDepcheckResult(pkgName: string, unused: DepcheckResult): void {
  const hasIssues =
    Object.keys(unused.missing).length > 0 ||
    unused.dependencies.length > 0 ||
    unused.devDependencies.length > 0;

  if (!hasIssues) {
    return;
  }

  consola.log('');
  consola.log(colors.cyan('📦 Package:'), pkgName);

  if (Object.keys(unused.missing).length > 0) {
    consola.log(colors.red('  ✖ Missing dependencies:'));
    Object.entries(unused.missing).forEach(([dep, files]) => {
      consola.log(`    - ${dep}:`);
      files.forEach((file) => consola.log(`      → ${file}`));
    });
  }

  if (unused.dependencies.length > 0) {
    consola.log(colors.yellow('  ⚠ Unused dependencies:'));
    unused.dependencies.forEach((dep) => consola.log(`    - ${dep}`));
  }

  if (unused.devDependencies.length > 0) {
    consola.log(colors.yellow('  ⚠ Unused devDependencies:'));
    unused.devDependencies.forEach((dep) => consola.log(`    - ${dep}`));
  }
}

/**
 * 运行依赖检查
 * @param config - 配置选项
 */
async function runDepcheck(config: DepcheckConfig = {}): Promise<void> {
  const { check = false, ...restConfig } = config;

  try {
    const finalConfig = {
      ignoreMatches: [
        ...DEFAULT_CONFIG.ignoreMatches,
        ...(restConfig.ignoreMatches ?? []),
      ],
      ignorePackages: [
        ...DEFAULT_CONFIG.ignorePackages,
        ...(restConfig.ignorePackages ?? []),
      ],
      ignorePatterns: [
        ...DEFAULT_CONFIG.ignorePatterns,
        ...(restConfig.ignorePatterns ?? []),
      ],
    };

    let hasIssues = false;

    const { packages } = await spinner(
      { title: 'Analyzing dependencies...' },
      () => getPackages(),
    );

    await Promise.all(
      packages.map(async (pkg: PackageInfo) => {
        // 跳过需要忽略的包
        if (finalConfig.ignorePackages.includes(pkg.packageJson.name)) {
          return;
        }

        const unused = await depcheck(pkg.dir, {
          ignoreMatches: finalConfig.ignoreMatches,
          ignorePatterns: finalConfig.ignorePatterns,
        });

        cleanDepcheckResult(unused);

        const pkgHasIssues =
          Object.keys(unused.missing).length > 0 ||
          unused.dependencies.length > 0 ||
          unused.devDependencies.length > 0;

        if (pkgHasIssues) {
          hasIssues = true;
          formatDepcheckResult(pkg.packageJson.name, unused);
        }
      }),
    );

    if (hasIssues) {
      consola.error(colors.red(`${UNICODE.FAILURE} Dependency issues found`));
      if (!check) {
        process.exit(1);
      }
    } else {
      consola.success(
        colors.green(`${UNICODE.SUCCESS} No dependency issues found`),
      );
    }
  } catch (error) {
    consola.error(
      colors.red('Dependency check failed:'),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

/**
 * 定义依赖检查命令
 * @param cac - CAC实例
 */
function defineDepcheckCommand(cac: CAC): void {
  cac
    .command('check-dep')
    .option(
      '--ignore-packages <packages>',
      'Packages to ignore, comma separated',
    )
    .option(
      '--ignore-matches <matches>',
      'Dependency patterns to ignore, comma separated',
    )
    .option(
      '--ignore-patterns <patterns>',
      'File patterns to ignore, comma separated',
    )
    .option('--check', 'Only check, do not exit on issues.')
    .usage('Analyze project dependencies')
    .action(
      async ({ check, ignoreMatches, ignorePackages, ignorePatterns }) => {
        const config: DepcheckConfig = {
          check,
          ...(ignorePackages && { ignorePackages: ignorePackages.split(',') }),
          ...(ignoreMatches && { ignoreMatches: ignoreMatches.split(',') }),
          ...(ignorePatterns && { ignorePatterns: ignorePatterns.split(',') }),
        };

        await runDepcheck(config);
      },
    );
}

export { defineDepcheckCommand, type DepcheckConfig };
