import type {
  ExcelSchemaField,
  ExcelSchemaReadResult,
} from '../../utils/excel-helper';

import { readExcelWithSchema } from '../../utils/excel-helper';

interface ProductCompareImportTemplate {
  id: string;
  label: string;
  schema: ExcelSchemaField[];
  scoreBoosts?: Partial<Record<string, number>>;
}

export interface ProductCompareTemplateReadResult extends ExcelSchemaReadResult {
  matchedTemplateId: string;
  matchedTemplateLabel: string;
}

const FIELD_WEIGHTS: Record<string, number> = {
  monthlySales: 1,
  productName: 4,
  procurementCost: 6,
  purchaseUnit: 2,
  sku: 2,
  specification: 4,
  supplierCode: 1,
  supplierName: 2,
  supplierProductLink: 1,
  supplierProductName: 3,
  supplierProductSpec: 3,
  upc: 10,
};

const BASE_COMPARE_SCHEMA: ExcelSchemaField[] = [
  {
    key: 'upc',
    aliases: ['商品UPC', 'UPC', '商品条码', '条码', '商品条形码', '国际条码'],
  },
  {
    key: 'sku',
    aliases: ['商品SKU', 'SKU', '商品编码', 'SKU编码', '货号', '商品代码', '商品编号'],
    required: false,
  },
  {
    key: 'productName',
    aliases: ['商品名称', '名称', '货品名称', '品名', '宝贝名称'],
    required: false,
  },
  {
    key: 'specification',
    aliases: ['规格', '商品规格', '规格名称', '型号', '商品型号'],
    required: false,
  },
  {
    key: 'procurementCost',
    aliases: [
      '采购价(门店采购价)',
      '采购价',
      '门店采购价',
      '进价',
      '采购单价',
      '供货价',
      '供货单价',
      '结算价',
      '成本价',
      '未税单价',
      '含税单价',
      '最小单位采购价',
      '箱规采购价',
    ],
    required: false,
  },
  {
    key: 'monthlySales',
    aliases: ['月销', '月销量', '30天销量', '近30天销量', '30日销量', '销量', '销售数量'],
    required: false,
  },
  {
    key: 'supplierName',
    aliases: ['供应商名称', '供应商', '发货方名称', '客户名称', '客商名称'],
    required: false,
  },
  {
    key: 'supplierCode',
    aliases: ['供应商编码', '发货方编码', '客户编码'],
    required: false,
  },
  {
    key: 'supplierProductName',
    aliases: ['供应商商品名称', '货盘商品名称', '供应商货品名称'],
    required: false,
  },
  {
    key: 'supplierProductSpec',
    aliases: ['供应商商品规格', '货盘商品规格', '供应商货品规格'],
    required: false,
  },
  {
    key: 'supplierProductLink',
    aliases: ['采购链接', '供应商商品链接', '商品链接', '供应商链接'],
    required: false,
  },
  {
    key: 'purchaseUnit',
    aliases: ['采购单位', '补货单位', '单位', '销售单位'],
    required: false,
  },
];

function extendSchema(
  overrides: Partial<Record<string, string[]>>,
): ExcelSchemaField[] {
  return BASE_COMPARE_SCHEMA.map((field) => ({
    ...field,
    aliases: [...(overrides[field.key] || []), ...field.aliases],
  }));
}

const PRODUCT_COMPARE_IMPORT_TEMPLATES: ProductCompareImportTemplate[] = [
  {
    id: 'standard_compare',
    label: '标准货盘',
    schema: BASE_COMPARE_SCHEMA,
  },
  {
    id: 'supplier_price_list',
    label: '供应商货盘',
    schema: extendSchema({
      monthlySales: ['7日销量', '近7天销量'],
      procurementCost: ['货盘价', '供价', '参考采购价'],
      productName: ['货盘名称'],
      specification: ['货盘规格'],
      supplierProductLink: ['货盘链接'],
      supplierProductName: ['商品名称', '货盘名称'],
      supplierProductSpec: ['商品规格', '货盘规格'],
    }),
    scoreBoosts: {
      procurementCost: 2,
      supplierProductLink: 1,
      supplierProductName: 2,
      supplierProductSpec: 2,
    },
  },
  {
    id: 'product_master_export',
    label: '商品总表导出',
    schema: extendSchema({
      procurementCost: ['最小单位采购价', '箱规采购价'],
      purchaseUnit: ['最小单位', '采购单位'],
      sku: ['门店SKU', '商品SKU'],
      supplierCode: ['供应商商品编码'],
      supplierProductLink: ['采购链接'],
      supplierProductName: ['供应商商品名称'],
      supplierProductSpec: ['供应商商品规格'],
      upc: ['商品UPC', '商品条码'],
    }),
    scoreBoosts: {
      procurementCost: 3,
      supplierCode: 1,
      supplierProductLink: 1,
      supplierProductName: 2,
      supplierProductSpec: 2,
    },
  },
  {
    id: 'oby_statement',
    label: 'OBY账单',
    schema: extendSchema({
      monthlySales: ['销售数量'],
      productName: ['商品名称'],
      purchaseUnit: ['单位'],
      sku: ['商品代码'],
      specification: ['商品规格'],
      supplierName: ['客户名称'],
      upc: ['商品条码'],
    }),
    scoreBoosts: {
      monthlySales: 2,
      purchaseUnit: 2,
      sku: 2,
      supplierName: 1,
    },
  },
];

function scoreTemplateMatch(
  fieldMap: Record<string, string>,
  template: ProductCompareImportTemplate,
) {
  return Object.keys(fieldMap).reduce((score, key) => {
    const baseWeight = FIELD_WEIGHTS[key] || 0;
    const boost = template.scoreBoosts?.[key] || 0;
    return score + baseWeight + boost;
  }, 0);
}

export async function readProductCompareWorkbook(
  buffer: Buffer,
): Promise<ProductCompareTemplateReadResult> {
  const attempts = await Promise.all(
    PRODUCT_COMPARE_IMPORT_TEMPLATES.map(async (template) => {
      const result = await readExcelWithSchema(buffer, template.schema);
      return {
        result,
        score: scoreTemplateMatch(result.fieldMap, template),
        template,
      };
    }),
  );

  attempts.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const fieldDiff =
      Object.keys(right.result.fieldMap).length - Object.keys(left.result.fieldMap).length;
    if (fieldDiff !== 0) {
      return fieldDiff;
    }

    return right.result.data.length - left.result.data.length;
  });

  const bestMatch = attempts[0];
  if (!bestMatch) {
    return {
      data: [],
      fieldMap: {},
      headerRowIndex: 1,
      headers: [],
      matchedTemplateId: 'standard_compare',
      matchedTemplateLabel: '标准货盘',
    };
  }

  return {
    ...bestMatch.result,
    matchedTemplateId: bestMatch.template.id,
    matchedTemplateLabel: bestMatch.template.label,
  };
}
