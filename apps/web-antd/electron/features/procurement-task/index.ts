export type PurchaseType = 'aoixiang' | 'qianniuhua' | 'offline';
export type PurchaseTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'partial_success';

export interface PurchaseTask {
  id: string;
  type: PurchaseType;
  storeIds: string[];
  storeNames: string[];
  supplier?: string;
  status: PurchaseTaskStatus;
}

export interface PurchaseResult {
  success: boolean;
  message: string;
  orderCount?: number;
  totalAmount?: number;
  orderDetails?: any[];
}

function unsupported(functionName: string): never {
  throw new Error(
    `${functionName} \u5df2\u79fb\u9664\u6a21\u62df\u6267\u884c\u903b\u8f91\uff0c\u5f53\u524d\u8bf7\u901a\u8fc7 ProcurementTaskRunner \u5bf9\u63a5\u771f\u5b9e\u91c7\u8d2d\u6d41\u7a0b\u540e\u518d\u8c03\u7528\u3002`,
  );
}

export async function executeAoixiangPurchase(
  _task: PurchaseTask,
): Promise<PurchaseResult> {
  unsupported('executeAoixiangPurchase');
}

export async function executeQianniuhuaPurchase(
  _task: PurchaseTask,
): Promise<PurchaseResult> {
  unsupported('executeQianniuhuaPurchase');
}

export async function executePendingPayments(): Promise<PurchaseResult> {
  unsupported('executePendingPayments');
}

export const ProcurementRunner = {
  executeAoixiangPurchase,
  executeQianniuhuaPurchase,
  executePendingPayments,
};
