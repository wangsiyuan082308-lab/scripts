import { requestClient } from './request';

export interface SiteSelectionRequest {
  limit?: number;
  query?: string;
  scenePreference?: string;
}

export type SiteSelectionTaskStatus =
  | 'draft'
  | 'failed'
  | 'pending'
  | 'running'
  | 'succeeded';

export interface SiteSelectionRecommendation {
  avgMonthlyIncome: null | number;
  businessAreaType: string;
  city: string;
  coreAdvantages: string[];
  district: string;
  estimatedDailyOrders: null | number;
  grade: 'A' | 'B' | 'C' | 'D';
  id: string;
  locationName: string;
  nextActions: string[];
  population3km: null | number;
  populationDensity: null | number;
  recommendation: string;
  riskLevel: 'high' | 'low' | 'medium';
  riskNotes: string[];
  score: number;
  summary: string;
  topCompetitor9999Count: null | number;
}

export interface SiteSelectionResult {
  assumptions: string[];
  citySummary: string;
  generatedAt: string;
  items: SiteSelectionRecommendation[];
  marketVerdict: string;
  model: string;
  modelSource: string;
  nextActions: string[];
  query: string;
  total: number;
}

export interface SiteSelectionTaskPayload {
  query?: string;
  scenePreference?: string;
  taskName?: string;
}

export interface SiteSelectionTask {
  createdAt: string;
  id: string;
  lastError?: string;
  lastRunAt?: string;
  latestResult?: null | SiteSelectionResult;
  query: string;
  scenePreference?: string;
  status: SiteSelectionTaskStatus;
  taskName: string;
  updatedAt: string;
}

export async function recommendSiteSelection(data: SiteSelectionRequest) {
  return requestClient.post<SiteSelectionResult>(
    '/decision/site-selection/recommend',
    data,
  );
}

export async function getSiteSelectionTasks(params: Record<string, any> = {}) {
  return requestClient.get<{ items: SiteSelectionTask[]; total: number }>(
    '/decision/site-selection/tasks',
    { params },
  );
}

export async function getSiteSelectionTaskDetail(taskId: string) {
  return requestClient.get<SiteSelectionTask>(
    `/decision/site-selection/tasks/${taskId}`,
  );
}

export async function createSiteSelectionTask(data: SiteSelectionTaskPayload) {
  return requestClient.post<SiteSelectionTask>(
    '/decision/site-selection/tasks',
    data,
  );
}

export async function updateSiteSelectionTask(
  taskId: string,
  data: SiteSelectionTaskPayload,
) {
  return requestClient.put<SiteSelectionTask>(
    `/decision/site-selection/tasks/${taskId}`,
    data,
  );
}

export async function deleteSiteSelectionTask(taskId: string) {
  return requestClient.delete<boolean>(
    `/decision/site-selection/tasks/${taskId}`,
  );
}

export async function executeSiteSelectionTask(taskId: string) {
  return requestClient.post<SiteSelectionTask>(
    `/decision/site-selection/tasks/${taskId}/execute`,
  );
}
