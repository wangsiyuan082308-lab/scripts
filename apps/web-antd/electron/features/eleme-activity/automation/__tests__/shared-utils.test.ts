// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  decideBaohaoStep2Action,
  type BaohaoStep2Surface,
} from '../shared-utils';

function createSurface(
  overrides: Partial<BaohaoStep2Surface> = {},
): BaohaoStep2Surface {
  return {
    activeTab: '',
    hasBulkUploadTab: false,
    hasChooseProductTab: false,
    hasDropzone: false,
    hasExportButton: false,
    hasFileInput: false,
    hasTemplateDownload: false,
    ...overrides,
  };
}

describe('decideBaohaoStep2Action', () => {
  it('asks to switch to bulk upload when both tabs are present but upload surface is not ready yet', () => {
    const decision = decideBaohaoStep2Action(
      createSurface({
        activeTab: '选择商品',
        hasBulkUploadTab: true,
        hasChooseProductTab: true,
      }),
    );

    expect(decision).toEqual({
      action: 'switch_bulk_upload',
      reason: '检测到“批量上传”入口，优先切换到批量上传',
    });
  });

  it('marks step2 ready after bulk upload tab is active and export surface is visible', () => {
    const decision = decideBaohaoStep2Action(
      createSurface({
        activeTab: '批量上传',
        hasBulkUploadTab: true,
        hasChooseProductTab: true,
        hasExportButton: true,
        hasTemplateDownload: true,
      }),
    );

    expect(decision).toEqual({
      action: 'ready',
      reason: '已进入批量上传步骤',
    });
  });

  it('treats choose-product-only surface as manual-only', () => {
    const decision = decideBaohaoStep2Action(
      createSurface({
        activeTab: '选择商品',
        hasChooseProductTab: true,
      }),
    );

    expect(decision).toEqual({
      action: 'manual_only',
      reason: '当前活动仅出现“选择商品”入口，未出现“批量上传”',
    });
  });
});
