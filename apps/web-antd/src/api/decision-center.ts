import { requestClient } from '#/api/request';

export interface ProductCompareAiConfig {
  apiKey: string;
  baseUrl: string;
  matchPromptTemplate: string;
  model: string;
  newProductMonthlySalesThreshold: number;
}

export async function getProductCompareAiConfig() {
  return requestClient.get<ProductCompareAiConfig>(
    '/decision-center/product-compare/config',
  );
}

export async function saveProductCompareAiConfig(
  data: Partial<ProductCompareAiConfig>,
) {
  return requestClient.put<ProductCompareAiConfig>(
    '/decision-center/product-compare/config',
    data,
  );
}
