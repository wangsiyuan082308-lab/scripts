import type { CAC } from 'cac';

import { extname } from 'node:path';

import { colors, consola, getStagedFiles, spinner, UNICODE } from '@vben/node-utils';

import { circularDepsDetect } from 'circular-dependency-scanner';

// 默认配置
const DEFAULT_CONFIG = {
  allowedExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  ignoreDirs: [
    'dist',
    '.turbo',
    'output',
    '.cache',
    'scripts',
    'internal',
    'packages/effects/request/src/',
    'packages/@core/ui-kit/menu-ui/src/',
    'packages/@core/ui-kit/popup-ui/src/',
  ],
} as const;

// 类型定义
type CircularDependencyResult = string[];

interface CheckCircularConfig {
  allowedExtensions?: string[];
  check?: boolean;
  ignoreDirs?: string[];
}

interface CommandOptions {
  config?: CheckCircularConfig;
  staged: boolean;
  verbose: boolean;
}

/**
 * 格式化循环依赖的输出
 * @param circles - 循环依赖结果
 */
function formatCircles(circles: CircularDependencyResult[]): void {
  if (circles.length === 0) {
    consola.success(colors.green(`${UNICODE.SUCCESS} No circular dependencies found`));
    return;
  }

  consola.warn(colors.yellow('Circular dependencies found:'));
  circles.forEach((circle, index) => {
    consola.log(`\n  Circular dependency #${index + 1}:`);
    circle.forEach((file) => consola.log(`    → ${file}`));
  });
}

/**
 * 检查项目中的循环依赖
 */
async function checkCircular({
  config = {},
  staged,
  verbose,
}: CommandOptions): Promise<void> {
  const { check = false, ...restConfig } = config;

  try {
    // 合并配置
    const finalConfig = {
      ...DEFAULT_CONFIG,
      ...restConfig,
    };

    // 生成忽略模式
    const ignorePattern = `**/{${finalConfig.ignoreDirs.join(',')}}/**`;

    // 检测循环依赖
    const results = await spinner(
      { title: 'Detecting circular dependencies...' },
      () =>
        circularDepsDetect({
          absolute: staged,
          cwd: process.cwd(),
          ignore: [ignorePattern],
        }),
    );

    let finalResults = results;

    if (staged) {
      let files = await getStagedFiles();
      const allowedExtensions = new Set(finalConfig.allowedExtensions);

      // 过滤文件列表
      files = files.filter((file) => allowedExtensions.has(extname(file)));

      const circularFiles: CircularDependencyResult[] = [];

      for (const file of files) {
        for (const result of results) {
          const resultFiles = result.flat();
          if (resultFiles.includes(file)) {
            circularFiles.push(result);
          }
        }
      }

      finalResults = circularFiles;
    }

    verbose && formatCircles(finalResults);

    if (finalResults.length > 0) {
      consola.error(
        colors.red(`${UNICODE.FAILURE} ${finalResults.length} circular dependencies found`),
      );
      if (!check) {
        process.exit(1);
      }
    }
  } catch (error) {
    consola.error(
      colors.red('Error checking circular dependencies:'),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

/**
 * 定义检查循环依赖的命令
 */
function defineCheckCircularCommand(cac: CAC): void {
  cac
    .command('check-circular')
    .option('--staged', 'Only check staged files')
    .option('--verbose', 'Show detailed information')
    .option('--check', 'Only check, do not exit on issues.')
    .option('--ignore-dirs <dirs>', 'Directories to ignore, comma separated')
    .usage('Analyze project circular dependencies')
    .action(async ({ check, ignoreDirs, staged, verbose }) => {
      const config: CheckCircularConfig = {
        check,
        ...(ignoreDirs && { ignoreDirs: ignoreDirs.split(',') }),
      };

      await checkCircular({
        config,
        staged,
        verbose: verbose ?? true,
      });
    });
}

export { type CheckCircularConfig, defineCheckCircularCommand };
