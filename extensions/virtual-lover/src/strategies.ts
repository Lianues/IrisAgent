import {
  SCHEDULER_SERVICE_ID,
  type IrisAPI,
  type SchedulerScheduleConfig,
  type SchedulerService,
} from 'irises-extension-sdk';
import type {
  VirtualLoverConfig,
  VirtualLoverLateNightStrategyConfig,
  VirtualLoverMemoryStrategyConfig,
  VirtualLoverRandomStrategyConfig,
  VirtualLoverScheduledStrategyConfig,
  VirtualLoverWeatherStrategyConfig,
} from './config.js';
import { VIRTUAL_LOVER_PROACTIVE_TOOL_NAME } from './proactive-tool.js';

interface StrategySyncOperation {
  strategy: string;
  action: 'created' | 'updated' | 'disabled' | 'deleted' | 'skipped';
  jobId?: string;
  message?: string;
}

export interface StrategySyncResult {
  ok: boolean;
  operations: StrategySyncOperation[];
  error?: string;
}

const JOB_PREFIX = '[virtual-lover:';

function getScheduler(api: IrisAPI): SchedulerService | undefined {
  return api.services.get<SchedulerService>(SCHEDULER_SERVICE_ID);
}

function strategyJobName(strategy: string, label: string): string {
  return `${JOB_PREFIX}${strategy}] ${label}`;
}

function buildInstruction(reason: string): string {
  const args = { dryRun: false, reason };
  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    '必须调用工具，不要只用文字回复。',
    '工具参数如下：',
    JSON.stringify(args, null, 2),
  ].join('\n');
}

async function upsertCronJob(
  scheduler: SchedulerService,
  strategy: string,
  label: string,
  config: VirtualLoverScheduledStrategyConfig | VirtualLoverLateNightStrategyConfig,
): Promise<StrategySyncOperation> {
  const name = strategyJobName(strategy, label);
  const existing = (await scheduler.listJobs({ nameIncludes: name })).find((job) => job.name === name);

  if (!config.enabled) {
    if (existing?.enabled) {
      const disabled = await scheduler.disableJob(existing.id);
      return { strategy, action: 'disabled', jobId: disabled?.id ?? existing.id };
    }
    return { strategy, action: 'skipped', jobId: existing?.id, message: 'strategy disabled' };
  }

  const schedule: SchedulerScheduleConfig = { type: 'cron', expression: config.schedule };
  const payload = {
    name,
    schedule,
    instruction: buildInstruction(config.reason),
    silent: true,
    urgent: config.urgent,
    allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
  };

  if (existing) {
    const updated = await scheduler.updateJob(existing.id, payload);
    if (updated && !updated.enabled) await scheduler.enableJob(updated.id);
    return { strategy, action: 'updated', jobId: updated?.id ?? existing.id };
  }

  const created = await scheduler.createJob(payload);
  return { strategy, action: 'created', jobId: created.id };
}


async function upsertMemoryStrategyJob(
  scheduler: SchedulerService,
  config: VirtualLoverMemoryStrategyConfig,
): Promise<StrategySyncOperation> {
  return await upsertCronJob(scheduler, 'memory', '记忆关心', {
    enabled: config.enabled,
    schedule: config.schedule,
    reason: `${config.reason}\n\nLover memory query: ${config.query}`,
    urgent: config.urgent,
  });
}

async function upsertWeatherStrategyJob(
  scheduler: SchedulerService,
  config: VirtualLoverWeatherStrategyConfig,
): Promise<StrategySyncOperation> {
  return await upsertCronJob(scheduler, 'weather', '天气关心', config);
}

function parseTimeToMinutes(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function nextRandomAt(windowStart: string, windowEnd: string): number {
  const start = parseTimeToMinutes(windowStart) ?? 10 * 60;
  const end = parseTimeToMinutes(windowEnd) ?? 22 * 60;
  const now = new Date();
  const base = new Date(now);
  base.setSeconds(0, 0);

  const span = end > start ? end - start : (24 * 60 - start + end);
  const offset = Math.floor(Math.random() * Math.max(1, span));
  const minuteOfDay = (start + offset) % (24 * 60);
  base.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

  if (base.getTime() <= now.getTime()) {
    base.setDate(base.getDate() + 1);
  }
  return base.getTime();
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function syncRandomStrategy(
  scheduler: SchedulerService,
  config: VirtualLoverRandomStrategyConfig,
): Promise<StrategySyncOperation[]> {
  const operations: StrategySyncOperation[] = [];
  const namePrefix = `${JOB_PREFIX}random:`;
  const existing = await scheduler.listJobs({ nameIncludes: namePrefix });
  for (const job of existing) {
    const deleted = await scheduler.deleteJob(job.id);
    operations.push({ strategy: 'random', action: deleted ? 'deleted' : 'skipped', jobId: job.id, message: 'replace random once jobs' });
  }

  if (!config.enabled || config.maxPerDay <= 0) {
    operations.push({ strategy: 'random', action: 'skipped', message: 'strategy disabled or maxPerDay <= 0' });
    return operations;
  }

  const count = config.minPerDay + Math.floor(Math.random() * (config.maxPerDay - config.minPerDay + 1));
  const dateKey = todayKey();
  for (let index = 0; index < count; index++) {
    const name = strategyJobName(`random:${dateKey}:${index + 1}`, '随机主动消息');
    const created = await scheduler.createJob({
      name,
      schedule: { type: 'once', at: nextRandomAt(config.windowStart, config.windowEnd) },
      instruction: buildInstruction(config.reason),
      silent: true,
      urgent: false,
      allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
    });
    operations.push({ strategy: 'random', action: 'created', jobId: created.id });
  }
  return operations;
}

export async function syncVirtualLoverStrategies(api: IrisAPI, config: VirtualLoverConfig): Promise<StrategySyncResult> {
  const scheduler = getScheduler(api);
  if (!scheduler) {
    return { ok: false, operations: [], error: `${SCHEDULER_SERVICE_ID} service 不可用，请启用 cron extension。` };
  }

  const strategies = config.enabled && config.proactive.enabled
    ? config.proactive.strategies
    : {
      goodMorning: { ...config.proactive.strategies.goodMorning, enabled: false },
      goodnight: { ...config.proactive.strategies.goodnight, enabled: false },
      dailyCheckIn: { ...config.proactive.strategies.dailyCheckIn, enabled: false },
      random: { ...config.proactive.strategies.random, enabled: false },
      lateNight: { ...config.proactive.strategies.lateNight, enabled: false },
      memory: { ...config.proactive.strategies.memory, enabled: false },
      weather: { ...config.proactive.strategies.weather, enabled: false },
    };

  const operations: StrategySyncOperation[] = [];
  operations.push(await upsertCronJob(scheduler, 'goodMorning', '每日早安', strategies.goodMorning));
  operations.push(await upsertCronJob(scheduler, 'goodnight', '每日晚安', strategies.goodnight));
  operations.push(await upsertCronJob(scheduler, 'dailyCheckIn', '每日关心', strategies.dailyCheckIn));
  operations.push(await upsertCronJob(scheduler, 'lateNight', '深夜轻提醒', strategies.lateNight));
  operations.push(await upsertMemoryStrategyJob(scheduler, strategies.memory));
  operations.push(await upsertWeatherStrategyJob(scheduler, strategies.weather));
  operations.push(...await syncRandomStrategy(scheduler, strategies.random));

  if (!config.enabled || !config.proactive.enabled) {
    operations.push({
      strategy: 'all',
      action: 'skipped',
      message: !config.enabled
        ? 'virtual-lover.enabled 为 false，已禁用/跳过所有策略任务'
        : 'proactive.enabled 为 false，已禁用/跳过所有策略任务',
    });
  }

  return { ok: true, operations };
}
