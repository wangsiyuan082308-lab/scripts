/**
 * 饿了么活动报名 - 共享工具函数
 * 门店选择、iframe定位、协议勾选等通用逻辑
 */
import { Page, Frame } from 'playwright';

export type BaohaoStep2Surface = {
  activeTab: '' | '批量上传' | '选择商品';
  hasBulkUploadTab: boolean;
  hasChooseProductTab: boolean;
  hasDropzone: boolean;
  hasExportButton: boolean;
  hasFileInput: boolean;
  hasTemplateDownload: boolean;
};

export type BaohaoStep2Decision =
  | { action: 'ready'; reason?: string }
  | { action: 'switch_bulk_upload'; reason: string }
  | { action: 'manual_only'; reason: string }
  | { action: 'unknown'; reason: string };

export function decideBaohaoStep2Action(surface: BaohaoStep2Surface): BaohaoStep2Decision {
  const hasUploadSurface =
    surface.hasExportButton ||
    surface.hasTemplateDownload ||
    surface.hasDropzone ||
    surface.hasFileInput;

  if (surface.hasBulkUploadTab) {
    if (hasUploadSurface && surface.activeTab === '批量上传') {
      return { action: 'ready', reason: '已进入批量上传步骤' };
    }

    if (hasUploadSurface && !surface.hasChooseProductTab) {
      return { action: 'ready', reason: '已识别到批量上传界面' };
    }

    return { action: 'switch_bulk_upload', reason: '检测到“批量上传”入口，优先切换到批量上传' };
  }

  if (surface.hasChooseProductTab) {
    return { action: 'manual_only', reason: '当前活动仅出现“选择商品”入口，未出现“批量上传”' };
  }

  if (hasUploadSurface) {
    return { action: 'ready', reason: '已识别到导出/上传区域' };
  }

  return { action: 'unknown', reason: '未能进入第2步' };
}

async function readBaohaoStep2Surface(frame: Frame): Promise<BaohaoStep2Surface> {
  return frame.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const isVisible = (el: Element | null) => {
      if (!el) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const text = document.body.innerText || '';
    const tabNodes = Array.from(document.querySelectorAll('.ant-tabs-tab, [role="tab"], button, a, span, div, label'));

    const findTab = (label: string) =>
      tabNodes.find((node) => {
        const nodeText = normalize(node.textContent || '');
        return isVisible(node) && nodeText === label;
      }) || null;

    const findActiveTabLabel = () => {
      const active = tabNodes.find((node) => {
        if (!isVisible(node)) return false;
        const element = node as HTMLElement;
        return (
          element.classList.contains('ant-tabs-tab-active') ||
          element.getAttribute('aria-selected') === 'true' ||
          element.closest('.ant-tabs-tab-active')
        );
      });
      const activeText = normalize(active?.textContent || '');
      if (activeText === '批量上传' || activeText === '选择商品') return activeText;
      return '';
    };

    return {
      activeTab: findActiveTabLabel() as '' | '批量上传' | '选择商品',
      hasBulkUploadTab: !!findTab('批量上传'),
      hasChooseProductTab: !!findTab('选择商品'),
      hasDropzone: text.includes('拖拽'),
      hasExportButton: text.includes('导出商品数据') || text.includes('导出招商商品数据') || text.includes('导出招商文件'),
      hasFileInput: !!document.querySelector('input[type="file"]'),
      hasTemplateDownload: text.includes('下载报名模板'),
    };
  });
}

async function clickBaohaoStepTab(frame: Frame, label: '批量上传' | '选择商品'): Promise<boolean> {
  return frame.evaluate((targetLabel) => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const isVisible = (el: Element | null) => {
      if (!el) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, [role="tab"], button, a, span, div, label'));
    const target = nodes.find((node) => {
      const text = normalize(node.textContent || '');
      return isVisible(node) && text === targetLabel;
    }) as HTMLElement | undefined;

    if (!target) return false;
    const clickable =
      (target.closest('.ant-tabs-tab, [role="tab"], button, a, label') as HTMLElement | null) || target;
    clickable.click();
    return true;
  }, label).catch(() => false);
}

async function ensureBaohaoBulkUploadStep(frame: Frame, page: Page): Promise<{
  success: boolean;
  error?: string;
  step2Surface?: BaohaoStep2Surface;
}> {
  let surface = await readBaohaoStep2Surface(frame);
  let decision = decideBaohaoStep2Action(surface);

  if (decision.action === 'switch_bulk_upload') {
    const switched = await clickBaohaoStepTab(frame, '批量上传');
    await page.waitForTimeout(2500);
    surface = await readBaohaoStep2Surface(frame);
    decision = decideBaohaoStep2Action(surface);

    if (!switched && decision.action !== 'ready') {
      return {
        success: false,
        error: '检测到“批量上传”入口，但切换失败',
        step2Surface: surface,
      };
    }
  }

  if (decision.action === 'ready') {
    return { success: true, step2Surface: surface };
  }

  return {
    success: false,
    error: decision.reason,
    step2Surface: surface,
  };
}

/** 获取饿了么业务iframe（ms.ele.me / ebai-zs-webapp） */
export async function getTargetFrame(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const f of page.frames()) {
      try {
        const url = f.url();
        if (url.includes('ms.ele.me') || url.includes('ebai-zs-webapp')) return f;
      } catch {}
    }
    await page.waitForTimeout(500);
  }
  return page.mainFrame();
}

/** 选择门店 + 勾选协议 + 点击下一步，返回已选门店数 */
export async function selectStoresAndNext(
  frame: Frame,
  page: Page,
): Promise<{
  storeCount: number;
  success: boolean;
  error?: string;
  storeIds?: string[];
  storeNames?: string[];
}> {

  // 1. 自动选择当前活动中可报名的全部门店
  const storeResult = await frame.evaluate(() => {
    const isChecked = (node: Element | null) =>
      !!node && node.className.includes('ant-tree-checkbox-checked');
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const selectedNames: string[] = [];
    const selectedIds: string[] = [];
    let count = 0;

    const treeNodes = Array.from(document.querySelectorAll('.ant-tree-treenode'));
    for (const node of treeNodes) {
      const title = node.querySelector('.ant-tree-title');
      const titleText = normalize(title?.textContent || '');
      if (!titleText || titleText === '全选') continue;

      const checkbox = node.querySelector('.ant-tree-checkbox') as HTMLElement | null;
      const wrapper =
        (node.querySelector('.ant-tree-node-content-wrapper') as HTMLElement | null) ||
        (title as HTMLElement | null);

      if (!isChecked(checkbox)) {
        checkbox?.click?.();
        if (!checkbox && wrapper) wrapper.click();
      }

      if (titleText) {
        selectedNames.push(titleText);
      }
      const nodeId =
        normalize(
          (node as HTMLElement).getAttribute('data-node-key') ||
            (title as HTMLElement | null)?.getAttribute?.('title') ||
            '',
        ) || titleText;
      if (nodeId) {
        selectedIds.push(nodeId);
      }
      count += 1;
    }

    return {
      mode: 'all',
      result: count > 0 ? `checked_${count}` : 'none',
      selectedIds,
      selectedNames,
    };
  });
  await page.waitForTimeout(2000);

  // 2. 验证门店数
  const storeCount = await frame.evaluate(() => {
    const m = document.body.innerText.match(/已选门店[（(](\d+)[)）]/);
    return m ? parseInt(m[1]) : 0;
  });

  if (storeCount === 0) {
    return {
      storeCount: 0,
      success: false,
      error: `活动内选店失败 (${storeResult.result})`,
    };
  }

  // 3. 勾选协议
  await frame.evaluate(() => {
    const cb = document.querySelector('.ant-checkbox-wrapper:not(.ant-checkbox-wrapper-checked)') as HTMLElement;
    if (cb) cb.click();
  });
  await page.waitForTimeout(500);

  // 4. 点击"下一步"
  const nextClicked = await frame.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent?.trim() === '下一步' && !b.disabled
    );
    if (btn) { btn.click(); return true; }
    return false;
  });

  if (!nextClicked) {
    return { storeCount, success: false, error: '下一步按钮不可用' };
  }

  await page.waitForTimeout(5000);

  // 5. 优先切到“批量上传”tab，再验证是否进入批量上传第2步
  const step2Result = await ensureBaohaoBulkUploadStep(frame, page);

  return {
    storeCount,
    success: step2Result.success,
    error: step2Result.success
      ? undefined
      : `${step2Result.error || '未能进入第2步'}${step2Result.step2Surface ? ` (${JSON.stringify(step2Result.step2Surface)})` : ''}`,
    storeIds: storeResult.selectedIds,
    storeNames: storeResult.selectedNames,
  };
}

/** JS点击有尺寸的报名按钮（详情页可能是“立即报名/追加报名”） */
export async function clickSignupButton(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const labels = ['立即报名', '追加报名', '继续报名'];
    for (const btn of Array.from(document.querySelectorAll('button'))) {
      const text = (btn.textContent || '').trim();
      if (labels.some(label => text === label || text.includes(label))) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { btn.click(); return true; }
      }
    }
    return false;
  });
}
