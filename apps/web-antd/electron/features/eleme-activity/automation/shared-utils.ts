/**
 * 饿了么活动报名 - 共享工具函数
 * 门店选择、iframe定位、协议勾选等通用逻辑
 */
import { Page, Frame } from 'playwright';

/** 获取饿了么业务iframe（ms.ele.me / ebai-zs-webapp） */
export async function getTargetFrame(page: Page): Promise<Frame> {
  for (const f of page.frames()) {
    try {
      const url = f.url();
      if (url.includes('ms.ele.me') || url.includes('ebai-zs-webapp')) return f;
    } catch {}
  }
  return page.mainFrame();
}

/** 全选门店 + 勾选协议 + 点击下一步，返回已选门店数 */
export async function selectStoresAndNext(frame: Frame, page: Page): Promise<{ storeCount: number; success: boolean; error?: string }> {
  // 1. 全选门店（ant-tree checkbox）
  const storeResult = await frame.evaluate(() => {
    // 优先找"全选"树节点的checkbox
    const treeNodes = Array.from(document.querySelectorAll('.ant-tree-treenode'));
    for (const node of treeNodes) {
      const title = node.querySelector('.ant-tree-title');
      if (title && title.textContent?.trim() === '全选') {
        const cb = node.querySelector('.ant-tree-checkbox') as HTMLElement;
        if (cb && !cb.className.includes('checked')) { cb.click(); return 'tree_全选'; }
        if (cb?.className.includes('checked')) return 'already_checked';
        const wrapper = node.querySelector('.ant-tree-node-content-wrapper') as HTMLElement;
        if (wrapper) { wrapper.click(); return 'wrapper_全选'; }
      }
    }
    // fallback: 点击所有未选中的tree checkbox
    let count = 0;
    document.querySelectorAll('.ant-tree-checkbox:not(.ant-tree-checkbox-checked)').forEach(cb => {
      (cb as HTMLElement).click(); count++;
    });
    return count > 0 ? `checked_${count}` : 'none';
  });
  await page.waitForTimeout(2000);

  // 2. 验证门店数
  const storeCount = await frame.evaluate(() => {
    const m = document.body.innerText.match(/已选门店[（(](\d+)[)）]/);
    return m ? parseInt(m[1]) : 0;
  });

  if (storeCount === 0) {
    return { storeCount: 0, success: false, error: `门店选择失败 (${storeResult})` };
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

  // 5. 验证到了第2步
  const isStep2 = await frame.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('导出商品数据') || text.includes('下载报名模板') || text.includes('拖拽');
  });

  return { storeCount, success: isStep2, error: isStep2 ? undefined : '未能进入第2步' };
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
