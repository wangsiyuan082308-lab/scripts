import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../site-selection', async () => {
  const actual = await vi.importActual<typeof import('../site-selection')>(
    '../site-selection',
  );
  return {
    ...actual,
    recommendSiteSelection: vi.fn(),
  };
});

import {
  normalizeSiteSelectionResponse,
  recommendSiteSelection,
} from '../site-selection';
import {
  createSiteSelectionTask,
  enqueueSiteSelectionTask,
  executeSiteSelectionTask,
  getSiteSelectionTask,
} from '../site-selection-task-store';

describe('normalizeSiteSelectionResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts candidates by score and derives fallback fields', () => {
    const result = normalizeSiteSelectionResponse(
      {
        limit: 2,
        query: '分析湖州的门店选址',
      },
      {
        citySummary: '湖州适合做首店验证。',
        items: [
          {
            city: '湖州',
            district: '吴兴区',
            estimatedDailyOrders: 220,
            locationName: '衣裳街',
            score: 81,
            summary: '夜经济强，但仓储难度高。',
          },
          {
            city: '湖州',
            district: '吴兴区',
            estimatedDailyOrders: 260,
            locationName: '万达广场',
            score: 88,
            summary: '首店优先点位。',
            topCompetitor9999Count: 2,
          },
        ],
        marketVerdict: '值得进入',
      },
      {
        model: 'qwen3.5-plus',
        source: 'shared_env',
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.locationName).toBe('万达广场');
    expect(result.items[0]?.grade).toBe('A');
    expect(result.items[1]?.recommendation).toBe('备选1');
    expect(result.marketVerdict).toBe('值得进入');
  });

  it('marks task as failed instead of throwing when model config is missing', async () => {
    vi.mocked(recommendSiteSelection).mockRejectedValueOnce(
      new Error('未配置可用模型'),
    );

    const task = createSiteSelectionTask({
      query: '分析湖州吴兴万达的选址',
      taskName: '湖州首店评估',
    });

    const executed = await executeSiteSelectionTask(task.id);

    expect(executed.status).toBe('failed');
    expect(executed.lastError).toContain('未配置可用模型');
  });

  it('queues task execution immediately instead of waiting for model response', () => {
    vi.useFakeTimers();
    vi.mocked(recommendSiteSelection).mockImplementation(
      () =>
        new Promise(() => {
          // keep pending
        }),
    );

    const task = createSiteSelectionTask({
      query: '分析湖州万达首店',
    });

    const queued = enqueueSiteSelectionTask(task.id);

    expect(queued.status).toBe('pending');

    void vi.runAllTimers();

    const running = getSiteSelectionTask(task.id);
    expect(['pending', 'running']).toContain(running.status);

    vi.useRealTimers();
  });
});
