// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

const originalHome = process.env.PRODUCT_MASTER_HOME;
const originalSource = process.env.PRODUCT_MASTER_SOURCE_PATH;
const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function loadProductMasterModule() {
  return await import('../index');
}

afterEach(async () => {
  const fs = await import('node:fs');
  process.env.PRODUCT_MASTER_HOME = originalHome;
  process.env.PRODUCT_MASTER_SOURCE_PATH = originalSource;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('product master runtime storage', () => {
  it('derives base unit procurement cost from carton pricing', async () => {
    const { getProductMasterProcurementPricing } = await loadProductMasterModule();

    const pricing = getProductMasterProcurementPricing({
      cartonSize: '12瓶/箱',
      procurementCost: 10.8,
      productName: '测试商品',
      upc: 'UPC-BOX',
    });

    expect(pricing.cartonProcurementCost).toBe(10.8);
    expect(pricing.baseUnitProcurementCost).toBe(0.9);
    expect(pricing.cartonSize).toBe('12瓶/箱');
  });

  it('does not auto-import on first load', async () => {
    const runtimeDir = await createTempDir('product-master-runtime-');
    const {
      getProductMasterRuntimePaths,
      getProductMasterStatus,
      loadProductMasterIndex,
    } = await loadProductMasterModule();

    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const index = await loadProductMasterIndex(true);
    const paths = getProductMasterRuntimePaths();
    const status = await getProductMasterStatus();
    const fs = await import('node:fs');

    expect(index.records).toHaveLength(0);
    expect(status.exists).toBe(false);
    expect(fs.existsSync(paths.rawPath)).toBe(false);
    expect(fs.existsSync(paths.indexPath)).toBe(false);
    expect(fs.existsSync(paths.metaPath)).toBe(false);
  });

  it('imports manual json into raw/index/meta files', async () => {
    const runtimeDir = await createTempDir('product-master-runtime-');
    const {
      findProductMasterRecord,
      getProductMasterRuntimePaths,
      getProductMasterStatus,
      importProductMasterJson,
      loadProductMasterIndex,
    } = await loadProductMasterModule();
    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const result = await importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            procurementCost: 9.9,
            productName: '别名商品',
            sku: 'SKU-2',
            skuAliases: ['SKU-2-A'],
            upc: 'UPC-2',
          },
        ]),
        'utf8',
      ),
      'manual.json',
    );

    const index = await loadProductMasterIndex(true);
    const paths = getProductMasterRuntimePaths();
    const status = await getProductMasterStatus();
    const fs = await import('node:fs');

    expect(result.recordCount).toBe(1);
    expect(fs.existsSync(paths.rawPath)).toBe(true);
    expect(fs.existsSync(paths.indexPath)).toBe(true);
    expect(fs.existsSync(paths.metaPath)).toBe(true);
    expect(status.exists).toBe(true);
    expect(status.recordCount).toBe(1);
    expect(findProductMasterRecord(index, { barcode: 'UPC-2' })?.productName).toBe(
      '别名商品',
    );
    expect(findProductMasterRecord(index, { sku: 'SKU-2-A' })?.procurementCost).toBe(
      9.9,
    );
  });

  it('can hydrate runtime data from legacy source path for headless flows', async () => {
    const runtimeDir = await createTempDir('product-master-runtime-');
    const legacyDir = await createTempDir('product-master-legacy-');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const {
      ensureProductMasterIndex,
      findProductMasterRecord,
      getProductMasterStatus,
    } = await loadProductMasterModule();
    const legacyPath = path.join(legacyDir, 'product-master.json');

    process.env.PRODUCT_MASTER_HOME = runtimeDir;
    process.env.PRODUCT_MASTER_SOURCE_PATH = legacyPath;

    fs.writeFileSync(
      legacyPath,
      JSON.stringify([
        {
          procurementCost: 12.5,
          productName: '旧来源商品',
          sku: 'SKU-LEGACY',
          upc: 'UPC-LEGACY',
        },
      ]),
      'utf8',
    );

    const index = await ensureProductMasterIndex({ allowLegacySource: true });
    const status = await getProductMasterStatus();

    expect(index.records).toHaveLength(1);
    expect(status.exists).toBe(true);
    expect(findProductMasterRecord(index, { barcode: 'UPC-LEGACY' })?.productName).toBe(
      '旧来源商品',
    );
  });
});
