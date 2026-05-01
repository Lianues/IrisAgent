import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIRTUAL_LOVER_CONFIG, parseVirtualLoverConfig } from '../extensions/virtual-lover/src/config.js';
import { syncVirtualLoverStrategies } from '../extensions/virtual-lover/src/strategies.js';
import { SCHEDULER_SERVICE_ID } from 'irises-extension-sdk';

function createScheduler() {
  const jobs: any[] = [];
  let seq = 0;
  return {
    jobs,
    createJob: vi.fn(async (input: any) => {
      const job = { id: `job-${++seq}`, enabled: true, ...input };
      jobs.push(job);
      return job;
    }),
    updateJob: vi.fn(async (id: string, input: any) => {
      const job = jobs.find((item) => item.id === id);
      Object.assign(job, input);
      return job;
    }),
    deleteJob: vi.fn(async (id: string) => {
      const index = jobs.findIndex((item) => item.id === id);
      if (index < 0) return false;
      jobs.splice(index, 1);
      return true;
    }),
    disableJob: vi.fn(async (id: string) => {
      const job = jobs.find((item) => item.id === id);
      if (job) job.enabled = false;
      return job;
    }),
    enableJob: vi.fn(async (id: string) => {
      const job = jobs.find((item) => item.id === id);
      if (job) job.enabled = true;
      return job;
    }),
    listJobs: vi.fn(async (filter?: any) => jobs.filter((job) => !filter?.nameIncludes || job.name.includes(filter.nameIncludes))),
  };
}

describe('virtual-lover proactive strategies', () => {
  it('解析默认策略配置', () => {
    const config = parseVirtualLoverConfig();
    expect(config.proactive.strategies.goodMorning).toMatchObject({ enabled: false, schedule: '0 8 * * *' });
    expect(config.proactive.strategies.random).toMatchObject({ windowStart: '10:00', windowEnd: '22:00', minPerDay: 0, maxPerDay: 2 });
    expect(config.proactive.strategies.lateNight).toMatchObject({ enabled: false, schedule: '0 1 * * *', urgent: true });
    expect(config.proactive.strategies.memory).toMatchObject({ enabled: false, schedule: '0 21 * * *' });
    expect(config.proactive.strategies.weather).toMatchObject({ enabled: false, schedule: '0 8 * * *' });
  });

  it('同步启用的 slot/lateNight 策略到 scheduler service', async () => {
    const scheduler = createScheduler();
    const api = { services: { get: vi.fn((id: string) => id === SCHEDULER_SERVICE_ID ? scheduler : undefined) } } as any;
    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        strategies: {
          ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive.strategies,
          goodMorning: { enabled: true, schedule: '0 8 * * *', reason: '早安', urgent: false },
          goodnight: { enabled: true, schedule: '0 23 * * *', reason: '晚安', urgent: false },
          lateNight: { enabled: true, schedule: '0 1 * * *', reason: '深夜', urgent: true },
          memory: { enabled: true, schedule: '0 21 * * *', query: '重要日期', reason: '记忆关心', urgent: false },
          weather: { enabled: true, schedule: '0 8 * * *', reason: '天气关心', urgent: false },
        },
      },
    };

    const result = await syncVirtualLoverStrategies(api, config);

    expect(result.ok).toBe(true);
    expect(scheduler.createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: '[virtual-lover:goodMorning] 每日早安',
      schedule: { type: 'cron', expression: '0 8 * * *' },
      allowedTools: ['virtual_lover_proactive_send'],
    }));
    expect(scheduler.jobs.map((job) => job.name)).toContain('[virtual-lover:lateNight] 深夜轻提醒');
    expect(scheduler.jobs.map((job) => job.name)).toContain('[virtual-lover:memory] 记忆关心');
    expect(scheduler.jobs.map((job) => job.name)).toContain('[virtual-lover:weather] 天气关心');
  });

  it('禁用策略会禁用已有 scheduler job', async () => {
    const scheduler = createScheduler();
    scheduler.jobs.push({ id: 'job-1', name: '[virtual-lover:goodMorning] 每日早安', enabled: true });
    const api = { services: { get: vi.fn(() => scheduler) } } as any;

    const result = await syncVirtualLoverStrategies(api, DEFAULT_VIRTUAL_LOVER_CONFIG);

    expect(result.ok).toBe(true);
    expect(scheduler.disableJob).toHaveBeenCalledWith('job-1');
  });

  it('proactive 总开关关闭时不会创建启用策略任务', async () => {
    const scheduler = createScheduler();
    const api = { services: { get: vi.fn(() => scheduler) } } as any;
    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: false,
        strategies: {
          ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive.strategies,
          goodMorning: { enabled: true, schedule: '0 8 * * *', reason: '早安', urgent: false },
        },
      },
    };

    const result = await syncVirtualLoverStrategies(api, config);
    expect(result.ok).toBe(true);
    expect(scheduler.createJob).not.toHaveBeenCalled();
    expect(result.operations.some((op) => op.strategy === 'all')).toBe(true);
  });
});
