import { Buffer } from 'node:buffer';

import { transformBaohaojiaBuffer } from './core';

interface BaohaojiaOptions {
  fileBuffer: Buffer;
  initialStock?: number;
}

export const ElemeBaohaojiaAnalyzer = {
  async run({ fileBuffer, initialStock = 9999 }: BaohaojiaOptions): Promise<{
    buffer: Buffer;
    summary: string;
  }> {
    return await transformBaohaojiaBuffer({
      fileBuffer,
      initialStock,
    });
  },
};
