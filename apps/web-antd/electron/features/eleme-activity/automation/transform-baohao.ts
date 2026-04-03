import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isCliEntry } from '../../../utils/is-main-module';
import { transformBaohaojiaBuffer } from '../../eleme-baohaojia/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

export async function transformBaohaojia(
  inputPath: string,
  initialStock = 9999,
): Promise<string> {
  console.warn(`\n=== 爆好价转换器 v2 ===`);
  console.warn(`读取文件: ${inputPath}`);
  console.warn(`初始库存: ${initialStock}`);

  const inputBuffer = await fs.readFile(inputPath);
  const { buffer, summary } = await transformBaohaojiaBuffer({
    fileBuffer: Buffer.from(inputBuffer),
    initialStock,
  });

  const outputName = `${path.basename(inputPath, path.extname(inputPath))}_报名.xlsx`;
  const outputPath = path.join(DATA_DIR, outputName);

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(outputPath, buffer);

  console.warn(summary);
  console.warn(`\n输出文件: ${outputPath}`);

  return outputPath;
}

async function runCli() {
  const inputFile = process.argv[2];
  const stock = Number.parseInt(process.argv[3] || '9999', 10);

  if (!inputFile) {
    console.error(
      '用法: ts-node transform-baohao.ts <输入Excel> [初始库存=9999]',
    );
    console.error('\n功能:');
    console.error('  1. 根据条码查询商品总表采购价');
    console.error('  2. 过滤采购价 > 活动价的商品');
    console.error('  3. 生成报名 Excel（含排除商品清单）');
    process.exitCode = 1;
    return;
  }

  try {
    const outputPath = await transformBaohaojia(inputFile, stock);
    console.warn('\n=== 完成 ===');
    console.warn(`报名文件: ${outputPath}`);
  } catch (error: any) {
    console.error('失败:', error.message);
    process.exitCode = 1;
  }
}

if (
  isCliEntry(
    'transform-baohao.ts',
    'transform-baohao.js',
    'transform-baohao.mjs',
    'transform-baohao.cjs',
  )
) {
  void runCli();
}
