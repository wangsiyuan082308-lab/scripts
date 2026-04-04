import type {
  BaohaojiaAnalysisMetrics,
  BaohaojiaAnalysisResult,
  BaohaojiaBaseRow,
  BaohaojiaExcludedRow,
  ProductMasterLookupRecord,
  BaohaojiaQualifiedRow,
  BaohaojiaReviewRow,
  BaohaojiaTransformArtifacts,
  BaohaojiaUploadRow,
} from '../../eleme-baohaojia/core';

import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isCliEntry } from '../../../utils/is-main-module';
import {
  analyzeBaohaojiaBuffer,
  transformBaohaojiaArtifacts,
} from '../../eleme-baohaojia/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

export type {
  BaohaojiaAnalysisMetrics,
  BaohaojiaAnalysisResult,
  BaohaojiaBaseRow,
  BaohaojiaExcludedRow,
  BaohaojiaQualifiedRow,
  BaohaojiaReviewRow,
  BaohaojiaTransformArtifacts,
  BaohaojiaUploadRow,
};

export { analyzeBaohaojiaBuffer };

export type BaohaojiaTransformPaths = BaohaojiaAnalysisResult & {
  auditPath: string;
  uploadPath: string;
};

export async function transformBaohaojiaBuffer(
  fileBuffer: Buffer,
  initialStock = 9999,
  productMasterRecords?: ProductMasterLookupRecord[],
): Promise<BaohaojiaTransformArtifacts> {
  return transformBaohaojiaArtifacts(
    fileBuffer,
    initialStock,
    productMasterRecords,
  );
}

export async function transformBaohaojiaWithArtifacts(
  inputPath: string,
  initialStock = 9999,
  productMasterRecords?: ProductMasterLookupRecord[],
): Promise<BaohaojiaTransformPaths> {
  console.warn('\n=== 爆好价转换器 ===');
  console.warn(`读取文件: ${inputPath}`);
  console.warn(`初始库存: ${initialStock}`);

  const sourceBuffer = await fs.readFile(inputPath);
  const { analysis, auditBuffer, uploadBuffer } =
    await transformBaohaojiaBuffer(
      sourceBuffer,
      initialStock,
      productMasterRecords,
    );

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const uploadPath = path.join(DATA_DIR, `${baseName}_报名.xlsx`);
  const auditPath = path.join(DATA_DIR, `${baseName}_审计.xlsx`);

  await Promise.all([
    fs.writeFile(uploadPath, uploadBuffer),
    fs.writeFile(auditPath, auditBuffer),
  ]);

  console.warn('\n=== 过滤结果 ===');
  console.warn(analysis.summary);
  console.warn(`\n报名文件: ${uploadPath}`);
  console.warn(`审计文件: ${auditPath}`);

  return {
    ...analysis,
    auditPath,
    uploadPath,
  };
}

export async function transformBaohaojia(
  inputPath: string,
  initialStock = 9999,
  productMasterRecords?: ProductMasterLookupRecord[],
): Promise<string> {
  const result = await transformBaohaojiaWithArtifacts(
    inputPath,
    initialStock,
    productMasterRecords,
  );
  return result.uploadPath;
}

if (
  isCliEntry(
    'transform-baohao.ts',
    'transform-baohao.js',
    'transform-baohao.mjs',
    'transform-baohao.cjs',
  )
) {
  const inputFile = process.argv[2];
  const stock = Number.parseInt(process.argv[3] || '9999', 10);

  if (inputFile) {
    transformBaohaojiaWithArtifacts(inputFile, stock)
      .then((result) => {
        console.warn('\n=== 完成 ===');
        console.warn(`报名文件: ${result.uploadPath}`);
        console.warn(`审计文件: ${result.auditPath}`);
      })
      .catch((error) => {
        console.error('失败:', error.message);
        process.exitCode = 1;
      });
  } else {
    console.error(
      '用法: ts-node transform-baohao.ts <输入Excel> [初始库存=9999]',
    );
    console.error('\n功能:');
    console.error('  1. 根据条码查询商品总表采购价');
    console.error('  2. 过滤采购价 > 活动价的商品');
    console.error('  3. 输出平台上传文件和审计文件');
    process.exitCode = 1;
  }
}
