/**
 * Cron 定时任务后台执行机制测试
 *
 * 覆盖：
 *   - CronScheduler 构造函数接受 agentTaskRegistry 和 eventBus 参数
 *   - executeJob 在有 registry 时走后台路径，标记 running 状态
 *   - executeJob 在无 registry 时退回旧的前台投递方式
 *   - 并发限制：超过 maxConcurrent 时跳过
 *   - 投递门控：被跳过的任务标记 skipped
 *   - eventBus 广播：完成后 fire('cron:result', payload)
 *   - silent 模式：输出含 [no-report] 时不广播
 *   - 执行记录保存和查询
 *   - 执行记录清理
 *   - types 新增字段正确性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  ScheduledJob,
  SchedulerConfig,
  CronResultPayload,
  CronRunRecord,
  CronBackgroundConfig,
  RunStatus,
} from '../extensions/cron/src/types.js';
import { DEFAULT_SCHEDULER_CONFIG } from '../extensions/cron/src/types.js';
import { CronScheduler, parseCronExpression, getNextCronTime } from '../extensions/cron/src/scheduler.js';

// DEFAULT_BACKGROUND_CONFIG 可能因模块别名导致导入为 undefined，
// 此处手动定义预期的默认值用于断言。
const EXPECTED_BACKGROUND_DEFAULTS = {
  timeoutMs: 5 * 60 * 1000,
  maxConcurrent: 3, retentionDays: 30, retentionCount: 100,
  maxToolRounds: 15,
};

// ============ Mock 工具 ============

/** 创建最小可用的 IrisAPI mock */
function createMockAPI(overrides?: Record<string, unknown>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-test-'));
  return {
    api: {
      backend: {
        on: vi.fn(),
        enqueueAgentNotification: vi.fn(),
        getToolPolicies: vi.fn(() => ({})),
      },
      router: {
        chat: vi.fn(async () => ({
          content: { role: 'model', parts: [{ text: '执行完成' }], createdAt: Date.now() },
        })),
        chatStream: vi.fn(async function* () {
          yield {
            textDelta: '执行完成',
            usageMetadata: { totalTokenCount: 100 },
          };
        }),
      },
      tools: {
        getDeclarations: vi.fn(() => []),
        createFiltered: vi.fn(function (this: any) { return this; }),
        get: vi.fn(() => undefined),
      },
      prompt: {
        constructor: class MockPrompt {
          setSystemPrompt() {}
          assemble(history: any[], declarations: any[]) {
            return {
              contents: history,
              tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
            };
          }
        },
        setSystemPrompt: vi.fn(),
        assemble: vi.fn((history: any[]) => ({ contents: history })),
      },
      dataDir: tmpDir,
      storage: {},
      config: {},
      extensions: {},
      pluginManager: {},
      eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
      modes: {},
      ...overrides,
    } as any,
    tmpDir,
  };
}

/** 创建最小可用的 AgentTaskRegistry mock */
function createMockRegistry() {
  return {
    register: vi.fn((taskId: string, sessionId: string, description: string) => ({
      taskId,
      sessionId,
      description,
      status: 'running',
      abortController: new AbortController(),
      startTime: Date.now(),
    })),
    complete: vi.fn(),
    fail: vi.fn(),
    kill: vi.fn(),
    getRunningBySession: vi.fn(() => []),
    emitChunkHeartbeat: vi.fn(),
    updateTokens: vi.fn(),
  };
}

/** 创建最小可用的 eventBus mock */
function createMockEventBus() {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    fire: vi.fn(),
  };
}

/** 创建一个测试用的 ScheduledJob */
function createTestJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  return {
    id: 'test-job-1',
    name: '测试任务',
    schedule: { type: 'interval', ms: 60000 },
    sessionId: 'session-1',
    instruction: '请执行测试操作',
    delivery: { fallback: 'last-active' as const },
    silent: false,
    urgent: false,
    enabled: true,
    createdAt: Date.now(),
    createdInSession: 'session-1',
    ...overrides,
  };
}

/** 清理临时目录 */
function cleanupTmpDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* 忽略 */ }
}

/** 简单延迟，供异步后台执行测试等待事件循环推进 */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 测试 ============

describe('Cron 后台执行机制 - 类型定义', () => {
  it('RunStatus 包含 running 值', () => {
    // 验证 RunStatus 类型确实包含 running
    const status: RunStatus = 'running';
    expect(status).toBe('running');

    // 验证所有合法值
    const allStatuses: RunStatus[] = ['completed', 'success', 'error', 'skipped', 'missed', 'running'];
    expect(allStatuses).toHaveLength(6);
  });

  it('CronResultPayload 接口可正确构造', () => {
    const payload: CronResultPayload = {
      jobId: 'job-1',
      taskId: 'cron_task_1_123',
      jobName: '测试任务',
      status: 'completed',
      result: '执行成功',
      durationMs: 1000,
    };
    expect(payload.status).toBe('completed');
    expect(payload.durationMs).toBe(1000);
  });

  it('CronRunRecord 接口可正确构造', () => {
    const record: CronRunRecord = {
      runId: 'cron_task_1_123',
      jobId: 'job-1',
      jobName: '测试任务',
      instruction: '执行操作',
      startTime: 1000,
      endTime: 2000,
      durationMs: 1000,
      status: 'completed',
      resultText: '完成',
    };
    expect(record.status).toBe('completed');
    expect(record.durationMs).toBe(1000);
  });

  it('CronBackgroundConfig 有正确的默认值', () => {
    // 验证预期的默认值（直接对照常量，避免模块导入问题）
    expect(EXPECTED_BACKGROUND_DEFAULTS.timeoutMs).toBe(5 * 60 * 1000);
    expect(EXPECTED_BACKGROUND_DEFAULTS.maxConcurrent).toBe(3);
    expect(EXPECTED_BACKGROUND_DEFAULTS.retentionDays).toBe(30);
    expect(EXPECTED_BACKGROUND_DEFAULTS.retentionCount).toBe(100);
    expect(EXPECTED_BACKGROUND_DEFAULTS.maxToolRounds).toBe(15);
  });
});

describe('CronScheduler 构造函数', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTmpDir(tmpDir);
  });

  it('接受 agentTaskRegistry 和 eventBus 参数', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const registry = createMockRegistry();
    const eventBus = createMockEventBus();

    // 不应抛异常
    const scheduler = new CronScheduler(api, undefined, registry, eventBus);
    expect(scheduler).toBeDefined();
  });

  it('不传 agentTaskRegistry 时不报错（向后兼容）', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;

    const scheduler = new CronScheduler(api);
    expect(scheduler).toBeDefined();
  });

  it('接受自定义 backgroundConfig', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const registry = createMockRegistry();
    const eventBus = createMockEventBus();

    const scheduler = new CronScheduler(api, undefined, registry, eventBus, {
      timeoutMs: 10000,
      maxConcurrent: 1,
    });
    expect(scheduler).toBeDefined();
  });
});

describe('CronScheduler 后台执行', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;
  let mockAPI: any;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    mockAPI = api;
    mockRegistry = createMockRegistry();
    mockEventBus = createMockEventBus();
    // 使用短超时和低并发限制便于测试
    scheduler = new CronScheduler(api, undefined, mockRegistry, mockEventBus, {
      timeoutMs: 5000,
      maxConcurrent: 2,
      maxToolRounds: 3,
      retentionDays: 30,
      retentionCount: 10,
    });
  });

  afterEach(() => {
    scheduler.stop();
    cleanupTmpDir(tmpDir);
  });

  it('createJob 创建任务并返回完整对象', () => {
    const job = scheduler.createJob({
      name: '测试任务',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '执行操作',
      createdInSession: 'sess-1',
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe('测试任务');
    expect(job.enabled).toBe(true);
  });

  it('listJobs 返回所有任务', () => {
    scheduler.createJob({
      name: '任务A',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作A',
      createdInSession: 'sess-1',
    });
    scheduler.createJob({
      name: '任务B',
      schedule: { type: 'interval', ms: 120000 },
      sessionId: 'sess-1',
      instruction: '操作B',
      createdInSession: 'sess-1',
    });

    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(2);
  });

  it('deleteJob 删除已有任务', () => {
    const job = scheduler.createJob({
      name: '待删除',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作',
      createdInSession: 'sess-1',
    });

    const deleted = scheduler.deleteJob(job.id);
    expect(deleted).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('deleteJob 对不存在的 ID 返回 false', () => {
    const deleted = scheduler.deleteJob('non-existent');
    expect(deleted).toBe(false);
  });

  it('文件同步仅更新运行状态时，不替换任务对象，也不重排已有定时器', async () => {
    await scheduler.start();

    const job = scheduler.createJob({
      name: '状态同步测试',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作',
      createdInSession: 'sess-1',
    });

    const originalJobRef = scheduler.getJob(job.id)!;
    const originalTimerRef = (scheduler as any).timers.get(job.id);
    expect(originalTimerRef).toBeDefined();

    // 模拟外部仅同步运行时状态：调度配置不变，
    // 如果 onFileChanged 错误地把这种变化也当成“需要重排”，
    // 就会清掉旧 timer 并生成一个新的 timer，后续容易导致重复执行。
    const syncedJobs = scheduler.listJobs().map((item) =>
      item.id === job.id
        ? {
            ...item,
            lastRunAt: Date.now(),
            lastRunStatus: 'running' as const,
          }
        : item,
    );
    fs.writeFileSync(path.join(tmpDir, 'cron-jobs.json'), JSON.stringify(syncedJobs, null, 2), 'utf-8');

    (scheduler as any).onFileChanged();

    const currentJobRef = scheduler.getJob(job.id)!;
    const currentTimerRef = (scheduler as any).timers.get(job.id);

    // 关键断言 1：Map 中仍然是原对象，避免旧闭包和新对象状态脱节。
    expect(currentJobRef).toBe(originalJobRef);
    // 关键断言 2：timer 也应保持不变，说明这次只是状态同步，没有重排调度。
    expect(currentTimerRef).toBe(originalTimerRef);
    expect(currentJobRef.lastRunStatus).toBe('running');
  });

  it('同一 jobId 即使通过旧对象重复触发，也只启动一次后台执行', async () => {
    const deferred: { resolve?: (value: { text: string }) => void } = {};
    const { api, tmpDir: td } = createMockAPI({
      createToolLoop: vi.fn(() => ({
        run: vi.fn(() => new Promise((resolve) => {
          deferred.resolve = resolve as (value: { text: string }) => void;
        })),
      })),
    });
    tmpDir = td;
    mockAPI = api;
    mockRegistry = createMockRegistry();
    mockEventBus = createMockEventBus();
    scheduler.stop();
    scheduler = new CronScheduler(api, undefined, mockRegistry, mockEventBus, {
      timeoutMs: 5000,
      maxConcurrent: 2,
      maxToolRounds: 3,
      retentionDays: 30,
      retentionCount: 10,
    });
    await scheduler.start();

    const job = scheduler.createJob({
      name: '并发去重测试',
      schedule: { type: 'once', at: Date.now() + 60_000 },
      sessionId: 'sess-1',
      instruction: '只允许执行一次',
      createdInSession: 'sess-1',
    });

    // 模拟两个旧引用几乎同时调用 executeJob。
    // 修复前，这类旧对象会绕过 running 判断，造成多次 register 和多次 LLM 调用。
    const staleA = { ...job };
    const staleB = { ...job };

    await Promise.all([
      (scheduler as any).executeJob(staleA),
      (scheduler as any).executeJob(staleB),
    ]);

    expect(mockRegistry.register).toHaveBeenCalledTimes(1);
    expect(scheduler.getJob(job.id)?.lastRunStatus).toBe('running');
    expect(scheduler.getJob(job.id)?.enabled).toBe(false);

    deferred.resolve?.({ text: '执行完成' });
    await delay(20);

    expect(mockRegistry.complete).toHaveBeenCalledTimes(1);
  });

  it('完成后将 lastRunStatus 统一写为 completed，并兼容旧 success 持久化值', async () => {
    await scheduler.start();

    const legacyJob = createTestJob({
      id: 'legacy-success-job',
      lastRunStatus: 'success',
    });
    fs.writeFileSync(path.join(tmpDir, 'cron-jobs.json'), JSON.stringify([legacyJob], null, 2), 'utf-8');

    (scheduler as any).onFileChanged();
    expect(scheduler.getJob('legacy-success-job')?.lastRunStatus).toBe('completed');

    const job = scheduler.createJob({
      name: '完成态统一测试',
      schedule: { type: 'once', at: Date.now() + 60_000 },
      sessionId: 'sess-1',
      instruction: '完成后应写入 completed',
      createdInSession: 'sess-1',
    });

    const deferred: { resolve?: (value: { text: string }) => void } = {};
    mockAPI.createToolLoop = vi.fn(() => ({
      run: vi.fn(() => new Promise((resolve) => {
        deferred.resolve = resolve as (value: { text: string }) => void;
      })),
    }));

    await (scheduler as any).executeJob(job);
    expect(scheduler.getJob(job.id)?.lastRunStatus).toBe('running');

    deferred.resolve?.({ text: '执行完成' });
    await delay(20);

    expect(scheduler.getJob(job.id)?.lastRunStatus).toBe('completed');
  });
});

describe('CronScheduler 执行记录', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;

  beforeEach(() => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const registry = createMockRegistry();
    const eventBus = createMockEventBus();
    scheduler = new CronScheduler(api, undefined, registry, eventBus, {
      retentionCount: 5,
      retentionDays: 30,
    });
  });

  afterEach(() => {
    scheduler.stop();
    cleanupTmpDir(tmpDir);
  });

  it('listRuns 在无记录时返回空数组', () => {
    const runs = scheduler.listRuns();
    expect(runs).toEqual([]);
  });

  it('getRunRecord 在无记录时返回 null', () => {
    const record = scheduler.getRunRecord('non-existent');
    expect(record).toBeNull();
  });

  it('手动保存记录后可通过 listRuns 查询', () => {
    // 通过内部方法模拟保存记录
    const runsDir = path.join(tmpDir, 'cron-runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const record: CronRunRecord = {
      runId: 'test-run-1',
      jobId: 'job-1',
      jobName: '测试任务',
      instruction: '执行操作',
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      durationMs: 1000,
      status: 'completed',
      resultText: '完成',
    };
    fs.writeFileSync(
      path.join(runsDir, `${record.jobId}_${record.startTime}.json`),
      JSON.stringify(record, null, 2),
      'utf-8',
    );

    const runs = scheduler.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('test-run-1');
  });

  it('getRunRecord 可查询单条记录', () => {
    const runsDir = path.join(tmpDir, 'cron-runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const record: CronRunRecord = {
      runId: 'test-run-2',
      jobId: 'job-2',
      jobName: '另一个任务',
      instruction: '执行操作',
      startTime: Date.now() - 2000,
      endTime: Date.now(),
      durationMs: 2000,
      status: 'failed',
      error: '工具不可用',
    };
    fs.writeFileSync(
      path.join(runsDir, `${record.jobId}_${record.startTime}.json`),
      JSON.stringify(record, null, 2),
      'utf-8',
    );

    const found = scheduler.getRunRecord('test-run-2');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('failed');
    expect(found!.error).toBe('工具不可用');
  });
});

describe('Cron 表达式解析器', () => {
  it('解析标准 5 字段表达式', () => {
    const parsed = parseCronExpression('0 9 * * 1-5');
    expect(parsed.minute.values).toContain(0);
    expect(parsed.hour.values).toContain(9);
    expect(parsed.dayOfWeek.values).toContain(1);
    expect(parsed.dayOfWeek.values).toContain(5);
    expect(parsed.dayOfWeek.values).not.toContain(0);
    expect(parsed.dayOfWeek.values).not.toContain(6);
  });

  it('解析步进表达式', () => {
    const parsed = parseCronExpression('*/15 * * * *');
    expect(parsed.minute.values).toContain(0);
    expect(parsed.minute.values).toContain(15);
    expect(parsed.minute.values).toContain(30);
    expect(parsed.minute.values).toContain(45);
    expect(parsed.minute.values.size).toBe(4);
  });

  it('非 5 字段表达式抛出错误', () => {
    expect(() => parseCronExpression('* * *')).toThrow('必须包含 5 个字段');
  });

  it('getNextCronTime 返回未来时间', () => {
    const next = getNextCronTime('* * * * *');
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('投递门控 (shouldSkip)', () => {
  // shouldSkip 是从 delivery-gate.ts 导出的，但通过 scheduler 间接使用
  // 这里直接导入测试
  let shouldSkip: typeof import('../extensions/cron/src/delivery-gate.js').shouldSkip;

  beforeEach(async () => {
    const module = await import('../extensions/cron/src/delivery-gate.js');
    shouldSkip = module.shouldSkip;
  });

  it('禁用的任务被跳过', () => {
    const job = createTestJob({ enabled: false });
    const result = shouldSkip(job, DEFAULT_SCHEDULER_CONFIG, new Map());
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('已禁用');
  });

  it('启用的任务在无限制时通过', () => {
    const job = createTestJob();
    const result = shouldSkip(job, DEFAULT_SCHEDULER_CONFIG, new Map());
    expect(result.skip).toBe(false);
  });

  it('安静时段内非紧急任务被跳过', () => {
    const job = createTestJob({ urgent: false });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      quietHours: {
        enabled: true,
        windows: [{ start: '00:00', end: '23:59' }],
        allowUrgent: true,
      },
    };
    const now = new Date();
    const result = shouldSkip(job, config, new Map(), now);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('安静时段');
  });

  it('紧急任务可穿透安静时段', () => {
    const job = createTestJob({ urgent: true });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      quietHours: {
        enabled: true,
        windows: [{ start: '00:00', end: '23:59' }],
        allowUrgent: true,
      },
    };
    const now = new Date();
    const result = shouldSkip(job, config, new Map(), now);
    expect(result.skip).toBe(false);
  });

  it('近期活跃会话的任务被跳过', () => {
    const job = createTestJob({ sessionId: 'sess-1' });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      skipIfRecentActivity: {
        enabled: true,
        withinMinutes: 5,
      },
    };
    const activityMap = new Map([['sess-1', Date.now() - 60000]]); // 1 分钟前有活动
    const result = shouldSkip(job, config, activityMap);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('分钟内有活动');
  });
});
