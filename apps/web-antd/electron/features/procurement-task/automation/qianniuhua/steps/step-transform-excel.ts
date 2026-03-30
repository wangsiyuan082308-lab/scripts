/**
 * Step 3: Excel转换 - ProcurementAnalyzer
 *
 * 独立运行: npx ts-node src/steps/step-transform-excel.ts [--supplier 供应商]
 */
import { Page } from 'playwright';
import * as path from 'path';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { StepResult, StepContext, PLANS_DIR } from '../lib/types-v2';
import { ProcurementAnalyzer } from '../lib/procurement-analyzer';
import { ensureDir } from '../lib/page-helpers';
import { log } from '../lib/utils';
import { saveContext, loadContext, createEmptyContext } from '../lib/context';
import { isCliEntry } from '../../../../../utils/is-main-module';

export async function stepTransformExcel(
  _page: Page, config: PurchaseConfig, ctx: StepContext,
): Promise<StepResult> {
  log('\n========== Step 3: Excel转换 ==========');

  try {
    if (!ctx.adviceFile) {
      return { step: 'transform-excel', success: false, message: '缺少 adviceFile（来自 Step 1）' };
    }
    if (!ctx.cartFile) {
      return { step: 'transform-excel', success: false, message: '缺少 cartFile（来自 Step 2）' };
    }

    ensureDir(PLANS_DIR);
    const outputFile = path.join(PLANS_DIR, 'plan-' + Date.now() + '.xlsx');

    const storeFilter = config.stores.length > 0
      ? config.stores.map(s => ({ name: s.name, maxItems: s.maxItems || 0 }))
      : undefined;

    const result = await ProcurementAnalyzer.runFromFiles({
      listFile: ctx.cartFile,
      refFile: ctx.adviceFile,
      outputFile,
      mode: config.analyzerMode,
      supplierFilter: ctx.supplier,
      storeFilter,
    });

    log('  转换完成: ' + result.summary);
    log('  门店: ' + result.storeNames.join(', '));
    log('  输出: ' + result.outputFile);

    ctx.planFile = result.outputFile;
    return { step: 'transform-excel', success: true, message: '转换完成: ' + result.outputFile };
  } catch (e: any) {
    return { step: 'transform-excel', success: false, message: e.message };
  }
}

// 独立运行入口（不需要浏览器，只读文件）
if (isCliEntry('step-transform-excel.ts', 'step-transform-excel.js', 'step-transform-excel.mjs', 'step-transform-excel.cjs')) {
  const { overrides } = parseCLI();
  const config = loadConfig(overrides);
  const ctx = loadContext() || createEmptyContext(config.supplier);

  if (!ctx.adviceFile || !ctx.cartFile) {
    log('ERROR: 需要先运行 step 1-4 生成 adviceFile 和 cartFile');
    log('  当前 ctx.adviceFile=' + (ctx.adviceFile || '(空)'));
    log('  当前 ctx.cartFile=' + (ctx.cartFile || '(空)'));
    process.exit(1);
  }

  (async () => {
    const result = await stepTransformExcel(null as any, config, ctx);
    log('\n结果: ' + JSON.stringify(result));
    if (result.success) saveContext(ctx);
  })().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
}
