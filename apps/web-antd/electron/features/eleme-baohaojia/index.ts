import type {
  BaohaojiaAnalysisMetrics,
  BaohaojiaAnalysisResult,
  BaohaojiaExcludedRow,
  BaohaojiaQualifiedRow,
  BaohaojiaReviewRow,
  BaohaojiaUploadRow,
  ProductMasterLookupRecord,
} from './core';

import { Buffer } from 'node:buffer';

import {
  analyzeBaohaojiaBuffer,
  extractBaohaojiaCodes,
  transformBaohaojiaArtifacts,
} from './core';

interface BaohaojiaOptions {
  fileBuffer: Buffer;
  initialStock?: number;
  productMasterRecords?: ProductMasterLookupRecord[];
}

export type {
  BaohaojiaAnalysisMetrics,
  BaohaojiaExcludedRow,
  BaohaojiaQualifiedRow,
  BaohaojiaReviewRow,
  BaohaojiaUploadRow,
};

export type ElemeBaohaojiaRunResult = {
  analysis: BaohaojiaAnalysisResult;
  auditBuffer: Buffer;
  summary: string;
  uploadBuffer: Buffer;
};

export const ElemeBaohaojiaAnalyzer = {
  async extractCodes(fileBuffer: Buffer): Promise<string[]> {
    return extractBaohaojiaCodes(fileBuffer);
  },

  async analyze({
    fileBuffer,
    initialStock = 9999,
    productMasterRecords,
  }: BaohaojiaOptions): Promise<BaohaojiaAnalysisResult> {
    return analyzeBaohaojiaBuffer(
      fileBuffer,
      initialStock,
      productMasterRecords,
    );
  },

  async run({
    fileBuffer,
    initialStock = 9999,
    productMasterRecords,
  }: BaohaojiaOptions): Promise<ElemeBaohaojiaRunResult> {
    const { analysis, auditBuffer, uploadBuffer } =
      await transformBaohaojiaArtifacts(
        fileBuffer,
        initialStock,
        productMasterRecords,
      );

    return {
      analysis,
      auditBuffer,
      summary: analysis.summary,
      uploadBuffer,
    };
  },
};
