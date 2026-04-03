import {
  analyzeBaohaojiaBuffer,
  transformBaohaojiaBuffer,
  type BaohaojiaAnalysisResult,
} from '../eleme-activity/automation/transform-baohao';

interface BaohaojiaOptions {
  fileBuffer: Buffer;
  initialStock?: number;
}

export {
  type BaohaojiaAnalysisMetrics,
  type BaohaojiaExcludedRow,
  type BaohaojiaQualifiedRow,
  type BaohaojiaReviewRow,
  type BaohaojiaUploadRow,
} from '../eleme-activity/automation/transform-baohao';

export type ElemeBaohaojiaRunResult = {
  analysis: BaohaojiaAnalysisResult;
  auditBuffer: Buffer;
  summary: string;
  uploadBuffer: Buffer;
};

export class ElemeBaohaojiaAnalyzer {
  static async analyze({
    fileBuffer,
    initialStock = 9999,
  }: BaohaojiaOptions): Promise<BaohaojiaAnalysisResult> {
    return analyzeBaohaojiaBuffer(fileBuffer, initialStock);
  }

  static async run({
    fileBuffer,
    initialStock = 9999,
  }: BaohaojiaOptions): Promise<ElemeBaohaojiaRunResult> {
    const { analysis, auditBuffer, uploadBuffer } = await transformBaohaojiaBuffer(
      fileBuffer,
      initialStock,
    );

    return {
      analysis,
      auditBuffer,
      summary: analysis.summary,
      uploadBuffer,
    };
  }
}
