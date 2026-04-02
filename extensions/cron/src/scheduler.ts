/**
 * 定时任务调度器核心模块
 *
 * 包含：
 * - 自实现的 Cron 表达式解析器（不依赖外部库）
 * - CronScheduler 类：内存调度 + setTimeout 驱动 + JSON 持久化
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPluginLogger } from '@irises/extension-sdk';
import type { IrisAPI, PluginEventBusLike } from '@irises/extension-sdk';
import type {
  ScheduledJob,
  SchedulerConfig,
  CreateJobParams,
  UpdateJobParams,
  ParsedCron,
  ParsedCronField,
  CronResultPayload,
  CronRunRecord,
  CronBackgroundConfig,
} from './types.js';
import { DEFAULT_SCHEDULER_CONFIG, DEFAULT_BACKGROUND_CONFIG } from './types.js';
import { shouldSkip } from './delivery-gate.js';

const logger = createPluginLogger('cron');

// ============ UUID 生成 ============

/** 生成 UUID v4 格式的唯一标识符 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============ Cron 解析器 ============

/**
 * 解析 cron 表达式中的单个字段
 *
 * 支持的语法：
 * - *        所有值
 * - 5        精确匹配
 * - 1,3,5    逗号分隔多值
 * - 1-5      连字符范围
 * - 星号/5   步进（从 min 开始，每隔 step）
 * - 1-10/2   范围内步进
 *
 * @param field 字段字符串
 * @param min 该字段的最小合法值
 * @param max 该字段的最大合法值
 * @returns 解析后的字段（包含所有匹配值的 Set）
 */
function parseCronField(field: string, min: number, max: number): ParsedCronField {
  const values = new Set<number>();
  // 逗号分隔的每一段独立解析
  const segments = field.split(',');

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (trimmed.includes('/')) {
      // 步进语法：*/5 或 1-10/2
      const [rangePart, stepStr] = trimmed.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`无效的步进值: "${trimmed}"`);
      }

      let start = min;
      let end = max;
      if (rangePart !== '*') {
        if (rangePart.includes('-')) {
          // 范围步进：1-10/2
          const [rs, re] = rangePart.split('-');
          start = parseInt(rs, 10);
          end = parseInt(re, 10);
        } else {
          // 单值步进：5/10 → 从 5 开始
          start = parseInt(rangePart, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (trimmed.includes('-')) {
      // 范围语法：1-5
      const [rs, re] = trimmed.split('-');
      const start = parseInt(rs, 10);
      const end = parseInt(re, 10);
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`无效的范围: "${trimmed}"`);
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else if (trimmed === '*') {
      // 通配：所有值
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else {
      // 精确数字
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) {
        throw new Error(`无效的 cron 字段值: "${trimmed}"`);
      }
      values.add(num);
    }
  }

  return { values };
}

/**
 * 解析完整的 5 字段 cron 表达式
 *
 * 字段顺序：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
 *
 * @param expression cron 表达式字符串
 * @returns 解析后的 ParsedCron 对象
 */
export function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron 表达式必须包含 5 个字段（分 时 日 月 周），实际收到 ${fields.length} 个字段: "${expression}"`
    );
  }

  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 6),
  };
}

/**
 * 判断指定时间是否匹配已解析的 cron 表达式
 *
 * @param parsed 解析后的 cron 对象
 * @param date 待检测的时间
 * @returns 是否匹配
 */
function matchesCron(parsed: ParsedCron, date: Date): boolean {
  return (
    parsed.minute.values.has(date.getMinutes()) &&
    parsed.hour.values.has(date.getHours()) &&
    parsed.dayOfMonth.values.has(date.getDate()) &&
    parsed.month.values.has(date.getMonth() + 1) && // JS 月份从 0 开始
    parsed.dayOfWeek.values.has(date.getDay())       // 0=周日
  );
}

/**
 * 计算 cron 表达式的下一次触发时间
 *
 * 从 after 的下一分钟开始，逐分钟向前扫描，最多扫描 366 天（527040 分钟）。
 * 如果在此范围内未找到匹配时间，抛出错误。
 *
 * @param expression cron 表达式字符串
 * @param after 起始时间（默认为当前时间）
 * @returns 下一次匹配的 Date 对象
 */
export function getNextCronTime(expression: string, after?: Date): Date {
  const parsed = parseCronExpression(expression);
  const cursor = after ? new Date(after.getTime()) : new Date();

  // 从下一分钟开始扫描（秒和毫秒清零）
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // 最多扫描 366 天
  const maxIterations = 527040;

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(parsed, cursor)) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(`在 366 天内未找到匹配的 cron 触发时间: "${expression}"`);
}

// ============ CronScheduler 类 ============

/**
 * AgentTaskRegistry 的最小接口（面向插件侧使用）。
 *
 * 避免 cron 插件直接依赖核心模块的 AgentTaskRegistry 类型，
 * 只声明 cron 实际需要用到的方法。
 * 运行时由 bootstrap 注入的实际 AgentTaskRegistry 实例满足此接口。
 */
interface AgentTaskRegistryLike {
  register(taskId: string, sessionId: string, description: string): {
    taskId: string;
    abortController?: AbortController;
  };
  complete(taskId: string, result?: string): void;
  fail(taskId: string, error: string): void;
  kill(taskId: string): void;
  getRunningBySession(sessionId: string): Array<{ taskId: string }>;
  emitChunkHeartbeat(taskId: string): void;
  updateTokens(taskId: string, tokens: number): void;
}

/** 定时任务专用系统提示词 */
const CRON_SYSTEM_PROMPT = `你是一个自动化定时任务执行器。

你的职责是执行用户预设的定时任务指令，完成后输出简洁的执行报告。

注意事项：
- 你在后台独立运行，没有用户正在与你对话
- 你的输出将作为通知推送给用户，请保持简洁明了
- 如果任务涉及文件操作，请使用可用的工具完成
- 完成后直接给出结论，不需要寒暄或确认`;

/** 生成任务 ID（与核心 createTaskId 的格式保持一致） */
let cronTaskCounter = 0;
function createCronTaskId(): string {
  return `cron_task_${++cronTaskCounter}_${Date.now()}`;
}

/**
 * 归一化历史运行状态。
 *
 * 目的：兼容旧版持久化文件中的 `success`，
 * 并统一对外输出为 `completed`，避免前端状态映射出现“任务已结束但仍显示 running”的问题。
 */
function normalizeRunStatus(status?: string): RunStatus | undefined {
  if (!status) return undefined;
  if (status === 'success') return 'completed';
  return status as RunStatus;
}

/**
 * 定时任务调度器
 *
 * 核心机制：
 * - 内存中维护任务 Map 和定时器 Map
 * - CRUD 操作直接改内存，debounce 500ms 写回 JSON 文件
 * - 进程重启时从文件恢复
 * - fs.watchFile 监听外部修改，增量同步
 */
export class CronScheduler {
  /** 所有任务（id → job） */
  private jobs: Map<string, ScheduledJob> = new Map();
  /** 活跃的 setTimeout 定时器（jobId → timer） */
  private timers: Map<string, NodeJS.Timeout> = new Map();
  /** 会话最后活跃时间（sessionId → timestamp），供投递门控使用 */
  private lastActivityMap: Map<string, number> = new Map();
  /** 调度器配置 */
  private config: SchedulerConfig;
  /** JSON 持久化文件路径 */
  private filePath: string;
  /** Iris API 引用 */
  private api: IrisAPI;
  /** debounce 持久化定时器 */
  private persistTimer: NodeJS.Timeout | null = null;
  /** 文件监听是否已启动 */
  private fileWatcherActive: boolean = false;
  /** 上次已知的文件修改时间（用于过滤自身写入触发的事件） */
  private lastFileModTime: number = 0;
  /** 调度器是否正在运行 */
  private running: boolean = false;
  /** 异步子代理任务注册表（后台执行时复用） */
  private agentTaskRegistry: AgentTaskRegistryLike | null = null;
  /** 插件事件总线（用于广播执行结果到各平台） */
  private eventBus: PluginEventBusLike | null = null;
  /** 后台执行配置 */
  private backgroundConfig: CronBackgroundConfig;
  /** 执行记录持久化目录 */
  private runsDir: string;
  /** 当前正在后台运行的任务数 */
  private activeBackgroundCount: number = 0;
  /**
   * 按任务 ID 跟踪当前正在执行的任务。
   * 目的：即使文件同步产生了旧对象 / 新对象两个实例，也只允许同一个 jobId 同时执行一次。
   */
  private executingJobIds: Set<string> = new Set();

  /**
   * @param api Iris API 实例（用于投递通知和获取数据目录）
   * @param config 调度器配置（缺省使用默认值）
   * @param agentTaskRegistry 异步任务注册表（可选，不提供时退回到旧的前台投递方式）
   * @param eventBus 插件事件总线（可选，不提供时不广播结果）
   * @param backgroundConfig 后台执行配置（可选，缺省使用默认值）
   */
  constructor(
    api: IrisAPI,
    config?: SchedulerConfig,
    agentTaskRegistry?: AgentTaskRegistryLike | null,
    eventBus?: PluginEventBusLike | null,
    backgroundConfig?: Partial<CronBackgroundConfig>,
  ) {
    this.api = api;
    this.config = config ? { ...config } : { ...DEFAULT_SCHEDULER_CONFIG };
    this.agentTaskRegistry = agentTaskRegistry ?? null;
    this.eventBus = eventBus ?? null;
    this.backgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG, ...backgroundConfig };

    // 根据 api.dataDir 确定持久化文件路径
    // 单 agent: ~/.iris/cron-jobs.json
    // 多 agent: ~/.iris/agents/<name>/cron-jobs.json
    const dataDir = api.dataDir
      ?? path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? '.',
        '.iris',
      );
    this.filePath = path.join(dataDir, 'cron-jobs.json');
    // 执行记录目录：与 cron-jobs.json 同级的 cron-runs/
    this.runsDir = path.join(dataDir, 'cron-runs');
  }

  // ──────────── 生命周期 ────────────

  /**
   * 启动调度器：从文件恢复任务 → 清理已完结的 once 任务 → 调度所有 enabled 任务 → 启动文件监听
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 从持久化文件恢复任务
    this.loadFromFile();

    // 在调度之前，先统一处理已完结或已过期的一次性任务。
    // 避免 scheduleNext() 混入业务状态判断。
    this.reconcileJobsOnStartup();

    // 为每个已启用的任务设置定时器
    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.scheduleNext(job);
      }
    }

    // 启动文件监听（轮询间隔 2 秒）
    this.startFileWatcher();

    logger.info(`调度器已启动，共 ${this.jobs.size} 个任务`);
  }

  /**
   * 停止调度器：清除所有定时器 → 停止文件监听 → 同步持久化
   */
  stop(): void {
    this.running = false;

    // 清除所有任务定时器
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // 停止文件监听
    this.stopFileWatcher();

    // 清除待执行的 debounce 持久化
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    // 最后一次同步写入
    this.persistSync();

    logger.info('调度器已停止');
  }

  // ──────────── CRUD 操作 ────────────

  /**
   * 创建新的定时任务
   * @param params 创建参数
   * @returns 创建好的任务对象
   */
  createJob(params: CreateJobParams): ScheduledJob {
    const job: ScheduledJob = {
      id: generateId(),
      name: params.name,
      schedule: params.schedule,
      sessionId: params.sessionId,
      instruction: params.instruction,
      delivery: {
        sessionId: params.delivery?.sessionId,
        fallback: params.delivery?.fallback ?? 'last-active',
      },
      silent: params.silent ?? false,
      urgent: params.urgent ?? false,
      enabled: true,
      createdAt: Date.now(),
      createdInSession: params.createdInSession,
    };

    this.jobs.set(job.id, job);

    // 如果任务启用则立即调度
    if (job.enabled) {
      this.scheduleNext(job);
    }
    this.debouncePersist();

    logger.info(`任务已创建: ${job.name} (${job.id})`);
    return job;
  }

  /**
   * 更新已有任务的属性
   * @param id 任务 ID
   * @param params 要更新的字段
   * @returns 更新后的任务，不存在时返回 null
   */
  updateJob(id: string, params: UpdateJobParams): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // 逐字段合并
    if (params.name !== undefined) job.name = params.name;
    if (params.schedule !== undefined) job.schedule = params.schedule;
    if (params.instruction !== undefined) job.instruction = params.instruction;
    if (params.delivery !== undefined) {
      job.delivery = { ...job.delivery, ...params.delivery };
    }
    if (params.silent !== undefined) job.silent = params.silent;
    if (params.urgent !== undefined) job.urgent = params.urgent;

    // 调度参数可能变了，需要重新设置定时器
    this.clearTimer(id);
    if (job.enabled) {
      this.scheduleNext(job);
    }
    this.debouncePersist();

    logger.info(`任务已更新: ${job.name} (${id})`);
    return job;
  }

  /**
   * 删除任务
   * @param id 任务 ID
   * @returns 是否成功删除
   */
  deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    this.clearTimer(id);
    this.jobs.delete(id);
    this.debouncePersist();

    logger.info(`任务已删除: ${job.name} (${id})`);
    return true;
  }

  /**
   * 启用任务
   * @param id 任务 ID
   * @returns 启用后的任务，不存在时返回 null，once 已过期时拒绝启用也返回 null
   */
  enableJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // 防止已过期的 once 任务被重新启用。
    // 过期的 once 任务不应再调度，直接拒绝。
    if (job.schedule.type === 'once' && job.schedule.at - Date.now() <= 0) {
      logger.warn(
        `拒绝启用已过期的一次性任务: ${job.name} (${id}), ` +
        `原定时间=${new Date(job.schedule.at).toISOString()}`
      );
      return null;
    }

    job.enabled = true;
    this.scheduleNext(job);
    this.debouncePersist();

    logger.info(`任务已启用: ${job.name} (${id})`);
    return job;
  }

  /**
   * 禁用任务
   * @param id 任务 ID
   * @returns 禁用后的任务，不存在时返回 null
   */
  disableJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    job.enabled = false;
    this.clearTimer(id);
    this.debouncePersist();

    logger.info(`任务已禁用: ${job.name} (${id})`);
    return job;
  }

  /** 按 ID 查询单个任务 */
  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  /** 返回所有任务的列表 */
  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /** 获取当前调度器配置 */
  getConfig(): SchedulerConfig {
    return this.config;
  }

  /**
   * 热更新调度器配置
   * 深合并传入的 partial 配置到当前配置。
   * @param newConfig 部分配置（会深合并到现有配置）
   */
  updateConfig(newConfig: Partial<SchedulerConfig>): void {
    if (newConfig.enabled !== undefined) {
      this.config.enabled = newConfig.enabled;
    }
    if (newConfig.quietHours) {
      this.config.quietHours = {
        ...this.config.quietHours,
        ...newConfig.quietHours,
      };
    }
    if (newConfig.skipIfRecentActivity) {
      this.config.skipIfRecentActivity = {
        ...this.config.skipIfRecentActivity,
        ...newConfig.skipIfRecentActivity,
      };
    }
    logger.info('调度器配置已热更新');
  }

  /**
   * 记录会话活跃时间
   * 由插件入口在 backend 'done' 事件中调用，供投递门控的 skipIfRecentActivity 使用。
   * @param sessionId 会话 ID
   */
  recordActivity(sessionId: string): void {
    this.lastActivityMap.set(sessionId, Date.now());
  }

  // ──────────── 调度与执行 ────────────

  /**
   * 启动时统一清理任务状态
   *
   * 在 start() 阶段调用，早于 scheduleNext()。
   * 职责：
   *   - 所有类型的 running 僵尸任务（进程崩溃残留） → 恢复为 error
   *   - 已有终态（success / error）的 once 任务 → 保留原状态，仅确保 enabled=false
   *   - 时间已过期且从未成功执行的 once 任务 → 标记 missed，禁用
   *   - 未过期的 once 任务 → 不做处理，交给 scheduleNext() 正常调度
   *
   * 这样 scheduleNext() 就可以保持纯粹的调度职责，不混入业务状态判断。
   */
  private reconcileJobsOnStartup(): void {
    let changed = false;

    for (const job of this.jobs.values()) {
      // 所有类型的僵尸 running 恢复：进程崩溃时任务还在 running，恢复为 error。
      // cron/interval 任务恢复后仍保持 enabled，下一轮正常调度；once 任务则禁用。
      if (job.lastRunStatus === 'running') {
        job.lastRunStatus = 'error';
        job.lastRunError = '进程重启前任务仍在执行中（僵尸任务恢复）';
        if (job.schedule.type === 'once') {
          job.enabled = false;
        }
        changed = true;
        logger.warn(`僵尸任务恢复: ${job.name} (${job.id}), type=${job.schedule.type}`);
        continue;
      }

      // 以下逻辑仅针对 once 类型
      if (job.schedule.type !== 'once') continue;

      const isExpired = job.schedule.at - Date.now() <= 0;

      // 已有终态（completed / error / missed），不再修改状态，仅确保禁用
      if (isExpired && (job.lastRunStatus === 'completed' || job.lastRunStatus === 'success' || job.lastRunStatus === 'error' || job.lastRunStatus === 'missed')) {
        if (job.enabled) {
          job.enabled = false;
          changed = true;
          logger.info(`一次性任务已完结，确保禁用: ${job.name} (${job.id}), status=${job.lastRunStatus}`);
        }
        continue;
      }

      // 情况 3：已过期但从未执行过（状态为空 / skipped 等），标记 missed 并禁用
      if (isExpired) {
        job.lastRunStatus = 'missed';
        job.lastRunAt = Date.now();
        job.enabled = false;
        changed = true;
        logger.warn(`一次性任务已过期，标记为 missed: ${job.name} (${job.id})`);
        continue;
      }

      // 情况 4：未过期 → 不做处理，交给 scheduleNext() 正常调度
    }

    if (changed) {
      this.debouncePersist();
    }
  }


  /**
   * 为指定任务计算下次触发时间并设置 setTimeout
   *
   * - cron：自行解析 cron 表达式，计算距离下次匹配的毫秒数
   * - interval：直接用 ms 值
   * - once：计算 at - now，已过期则跳过（过期判定由 reconcileJobsOnStartup 负责）
   */
  private scheduleNext(job: ScheduledJob): void {
    // 先清除可能存在的旧定时器
    this.clearTimer(job.id);

    // 这里故意只依赖 job.id，不依赖闭包里捕获的 job 对象本身。
    // 原因：文件同步 onFileChanged() 可能把 Map 中的任务替换为新对象。
    // 如果定时器继续持有旧对象引用，旧对象上的 running 状态就无法阻止新对象再次触发，
    // 会出现同一任务被并发执行多次的情况。
    const jobId = job.id;

    if (!job.enabled || !this.running) return;

    let delayMs: number;

    switch (job.schedule.type) {
      case 'cron': {
        try {
          const nextTime = getNextCronTime(job.schedule.expression);
          delayMs = nextTime.getTime() - Date.now();
        } catch (err) {
          logger.error(`计算 cron 下次触发时间失败 (${job.name}): ${err}`);
          return;
        }
        break;
      }
      case 'interval': {
        delayMs = job.schedule.ms;
        break;
      }
      case 'once': {
        delayMs = job.schedule.at - Date.now();
        if (delayMs <= 0) {
          // 已过期：不在此处修改任何业务状态。
          // 过期判定和 missed 标记统一由 reconcileJobsOnStartup() 在启动阶段处理。
          // 这里只需跳过调度即可。
          logger.debug(`一次性任务已过期，跳过调度: ${job.name} (${job.id})`);
          return;
        }
        break;
      }
    }

    const timer = setTimeout(() => {
      // 定时器一旦触发，先从表中移除，避免 once 任务留下失效句柄，
      // 也避免后续逻辑误以为“下次触发已排好”。
      this.timers.delete(jobId);

      // 触发时重新从 jobs Map 读取当前权威对象。
      // 这样即使文件同步更新了任务对象，也只会执行最新状态对应的那一份。
      const currentJob = this.jobs.get(jobId);
      if (!currentJob) return;

      void this.executeJob(currentJob);
    }, delayMs);

    // 防止定时器阻止 Node.js 进程退出
    if (timer.unref) {
      timer.unref();
    }

    this.timers.set(job.id, timer);
  }

  /**
   * 执行一个定时任务
   *
   * 改造后的流程（后台执行模式）：
   * 1. 投递门控检查（shouldSkip）
   * 2. 并发限制检查
   * 3. 向 AgentTaskRegistry 注册任务
   * 4. fire-and-forget 启动后台 ToolLoop（runCronJobInBackground）
   * 5. 更新任务状态为 running
   * 6. 非一次性任务立即调度下次执行
   *
   * 如果 agentTaskRegistry 不可用，退回到旧的前台投递方式。
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    // 每次执行前都重新从 Map 读取权威对象，
    // 防止调用方传入的是文件同步前留下的旧对象。
    const currentJob = this.jobs.get(job.id) ?? job;

    // 第一层防重入：按 jobId 去重，而不是按对象实例去重。
    // 这样即使旧定时器闭包里拿着旧对象，也无法绕过并发保护。
    if (this.executingJobIds.has(currentJob.id)) {
      logger.info(`任务正在执行中，跳过本次触发: ${currentJob.name} (${currentJob.id})`);
      return;
    }

    // 第二层防重入：兼容外部状态已经被写成 running 的场景。
    if (currentJob.lastRunStatus === 'running') {
      logger.info(`任务状态仍为 running，跳过本次触发: ${currentJob.name} (${currentJob.id})`);
      return;
    }

    // 投递门控检查
    const decision = shouldSkip(currentJob, this.config, this.lastActivityMap);
    if (decision.skip) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = 'skipped';
      // once 任务在它的唯一触发点被跳过后，也应当视为已消费，
      // 否则它会继续保持 enabled=true，后续容易被误判为 missed 或 pending。
      if (currentJob.schedule.type === 'once') {
        currentJob.enabled = false;
      }
      logger.info(`任务被跳过: ${currentJob.name} — ${decision.reason}`);
      this.debouncePersist();

      // 被跳过的非一次性任务仍需调度下次执行
      if (currentJob.schedule.type !== 'once') {
        this.scheduleNext(currentJob);
      }
      return;
    }

    // 非一次性任务立即调度下次执行（不等后台执行完成）
    if (currentJob.schedule.type !== 'once') {
      this.scheduleNext(currentJob);
    }

    // 并发限制检查
    if (this.activeBackgroundCount >= this.backgroundConfig.maxConcurrent) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = 'skipped';
      currentJob.lastRunError = `并发后台任务数已达上限 (${this.backgroundConfig.maxConcurrent})`;
      if (currentJob.schedule.type === 'once') {
        currentJob.enabled = false;
      }
      logger.warn(`任务被跳过（并发上限）: ${currentJob.name}`);
      this.debouncePersist();
      return;
    }

    // 检查 agentTaskRegistry 是否可用——可用则走后台 ToolLoop，否则退回旧方式
    if (!this.agentTaskRegistry) {
      // 退回到旧的前台投递方式（兼容未注入 registry 的场景）
      this.executeJobLegacy(currentJob);
      return;
    }

    // ---- 后台执行路径 ----

    // 生成任务 ID 并注册到 AgentTaskRegistry
    const taskId = createCronTaskId();
    // 使用虚拟 sessionId：cron:<jobId>，定时任务不关联实际 session
    const virtualSessionId = `cron:${currentJob.id}`;
    const description = `定时任务: ${currentJob.name}`;
    const task = this.agentTaskRegistry.register(taskId, virtualSessionId, description);

    // 更新任务状态为 running
    currentJob.lastRunAt = Date.now();
    currentJob.lastRunStatus = 'running';
    // once 任务一旦进入 running，就应立即从未来调度中移除。
    // 这样即使执行尚未完成，也不会再被文件同步或重载逻辑当成“尚未触发的一次性任务”。
    if (currentJob.schedule.type === 'once') {
      currentJob.enabled = false;
    }
    this.debouncePersist();

    // fire-and-forget 启动后台执行
    this.executingJobIds.add(currentJob.id);
    this.activeBackgroundCount++;
    void this.runCronJobInBackground(currentJob, taskId, task.abortController?.signal).finally(() => {
      this.activeBackgroundCount--;
      this.executingJobIds.delete(currentJob.id);

      // 如果任务在运行中被文件同步改动过，旧定时器可能已经被清空。
      // 对非 once 任务在收尾阶段补一次“缺定时器则重排”，保证后续周期不会丢。
      if (currentJob.schedule.type !== 'once' && currentJob.enabled && !this.timers.has(currentJob.id) && this.running) {
        this.scheduleNext(currentJob);
      }
    });

    logger.info(`后台任务已启动: ${currentJob.name} (taskId=${taskId})`);
  }

  /**
   * 旧的前台投递方式（退回兼容）
   *
   * 当 agentTaskRegistry 不可用时，仍通过 backend.enqueueAgentNotification
   * 投递到前台会话。保留此方法确保向后兼容。
   */
  private executeJobLegacy(job: ScheduledJob): void {
    try {
      const targetSessionId = job.delivery.sessionId ?? job.sessionId;

      // 旧路径同样遵守 once 任务“只消费一次”的语义。
      if (job.schedule.type === 'once') {
        job.enabled = false;
      }
      let instruction = job.instruction;
      if (job.silent) {
        instruction = '如果没有值得报告的内容，不要发送任何消息。\n' + instruction;
      }
      const xml = `<task-notification task-id="${job.id}" task-name="${job.name}">${instruction}</task-notification>`;
      const backend = this.api.backend as any;
      if (typeof backend.enqueueAgentNotification === 'function') {
        backend.enqueueAgentNotification(targetSessionId, xml);
        job.lastRunAt = Date.now();
        job.lastRunStatus = 'completed';
        logger.info(`任务已投递（旧方式）: ${job.name} → 会话 ${targetSessionId}`);
      } else {
        throw new Error('backend.enqueueAgentNotification 方法不可用');
      }
    } catch (err) {
      job.lastRunAt = Date.now();
      job.lastRunStatus = 'error';
      job.lastRunError = err instanceof Error ? err.message : String(err);
      logger.error(`任务执行失败: ${job.name} — ${err}`);
    }
    this.debouncePersist();
  }

  // ──────────── 后台执行 ────────────

  /**
   * 在后台独立执行一个定时任务（fire-and-forget）
   *
   * 核心流程：
   * 1. 通过 IrisAPI.createToolLoop 创建独立的 ToolLoop（定时任务专用系统提示词 + 过滤后的工具集）
   * 2. 构建流式 LLMCaller（回调指向 AgentTaskRegistry）
   * 3. 执行 ToolLoop.run()
   * 4. 保存执行记录
   * 5. 通过 eventBus 广播结果
   */
  private async runCronJobInBackground(
    job: ScheduledJob,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const startTime = Date.now();
    const registry = this.agentTaskRegistry!;

    // 设置执行超时：超时后通过 AbortController 中止 ToolLoop
    const timeoutHandle = setTimeout(() => {
      registry.kill(taskId);
      logger.warn(`后台任务超时 (${this.backgroundConfig.timeoutMs}ms): ${job.name}`);
    }, this.backgroundConfig.timeoutMs);
    // 超时定时器不应阻止进程退出
    if (timeoutHandle.unref) timeoutHandle.unref();

    try {
      // ---- 构建工具集：复用主 Backend 的 ToolRegistry，过滤不适用的工具 ----
      // 定时任务后台执行时需要排除的工具：
      // - sub_agent: 没有父会话上下文，子代理无意义
      // - history_search: 需要 sessionId，定时任务没有活跃会话
      // - manage_scheduled_tasks: 防止后台 agent 自作主张删除/修改定时任务本身
      const excludedTools = ['sub_agent', 'history_search', 'manage_scheduled_tasks'];
      // ToolRegistryLike 已声明 createFiltered?()，直接使用类型安全的调用
      const cronTools = this.api.tools.createFiltered?.(excludedTools) ?? this.api.tools;

      // ---- 构建系统提示词 ----
      // silent 模式时在提示词中追加 no-report 指示
      let systemPrompt = CRON_SYSTEM_PROMPT;
      if (job.silent) {
        systemPrompt += '\n- 如果没有值得报告的内容，请回复 `[no-report]`。';
      }

      // ---- 通过 IrisAPI.createToolLoop 创建 ToolLoop 实例 ----
      // 使用核心 ToolLoop 替代手写简化版循环，获得完整的重试、abort 清理、钩子支持
      // IrisAPI 已声明 createToolLoop?()，直接使用类型安全的调用
      if (typeof this.api.createToolLoop !== 'function') {
        throw new Error('IrisAPI.createToolLoop 不可用，无法执行后台任务');
      }
      const toolLoop = this.api.createToolLoop({
        tools: cronTools,
        systemPrompt,
        maxRounds: this.backgroundConfig.maxToolRounds,
      });

      // ---- 构建 LLMCaller：流式调用，回调指向 AgentTaskRegistry 以驱动心跳和 token 计数 ----
      // LLMRouterLike 已声明 chat?() 和 chatStream?()，直接使用类型安全的调用
      const router = this.api.router;
      const callLLM = async (request: any, modelName?: string, sig?: AbortSignal) => {
        if (router.chatStream) {
          const parts: any[] = [];
          let usageMetadata: any;
          for await (const chunk of router.chatStream(request, modelName, sig)) {
            registry.emitChunkHeartbeat(taskId);
            if (chunk.partsDelta && chunk.partsDelta.length > 0) {
              for (const part of chunk.partsDelta) {
                parts.push(part);
              }
            } else {
              if (chunk.textDelta) parts.push({ text: chunk.textDelta });
              if (chunk.functionCalls) {
                for (const fc of chunk.functionCalls) parts.push(fc);
              }
            }
            if (chunk.usageMetadata) {
              usageMetadata = chunk.usageMetadata;
              const tokens = usageMetadata.totalTokenCount ?? usageMetadata.candidatesTokenCount ?? 0;
              if (tokens > 0) {
                registry.updateTokens(taskId, tokens);
              }
            }
          }
          if (parts.length === 0) parts.push({ text: '' });
          const content: any = { role: 'model', parts, createdAt: Date.now() };
          if (usageMetadata) content.usageMetadata = usageMetadata;
          return content;
        }
        // 回退到非流式调用
        if (!router.chat) {
          throw new Error('LLMRouter 既不支持 chatStream 也不支持 chat，无法调用 LLM');
        }
        const response = await router.chat(request, modelName, sig);
        return response.content;
      };

      // ---- 构建用户消息并执行 ToolLoop ----
      const history: any[] = [];
      let userInstruction = job.instruction;
      if (job.silent) {
        userInstruction = '如果没有值得报告的内容，请回复 `[no-report]`。\n' + userInstruction;
      }
      history.push({ role: 'user', parts: [{ text: userInstruction }] });

      // 调用核心 ToolLoop.run()
      const result = await toolLoop.run(history, callLLM, { signal });

      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const finalText = result.text ?? '';
      const loopError = result.error;

      // ---- 处理结果 ----

      if (result.aborted) {
        // 被中止
        registry.kill(taskId);
        job.lastRunStatus = 'error';
        job.lastRunError = '后台任务被中止';
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'killed',
        });
        this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: 'killed', durationMs });
        logger.info(`后台任务被中止: ${job.name} (taskId=${taskId})`);

      } else if (loopError) {
        // 执行失败
        registry.fail(taskId, loopError);
        job.lastRunStatus = 'error';
        job.lastRunError = loopError;
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'failed', error: loopError,
        });
        this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: 'failed', error: loopError, durationMs });
        logger.error(`后台任务失败: ${job.name} (taskId=${taskId}), error="${loopError}"`);

      } else {
        // 成功：silent 模式检查——输出包含 [no-report] 时不广播
        const isSilentNoReport = job.silent && finalText.includes('[no-report]');

        registry.complete(taskId, finalText);
        job.lastRunStatus = 'completed';
        job.lastRunError = undefined;
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'completed', resultText: finalText,
        });

        if (!isSilentNoReport) {
          this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: 'completed', result: finalText, durationMs });
        }
        logger.info(`后台任务完成: ${job.name} (taskId=${taskId}), duration=${durationMs}ms, silent_skip=${isSilentNoReport}`);
      }

    } catch (err) {
      // 意外错误捕获（防御性编码）
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      registry.fail(taskId, errorMsg);
      job.lastRunStatus = 'error';
      job.lastRunError = errorMsg;
      this.saveRunRecord({
        runId: taskId, jobId: job.id, jobName: job.name,
        instruction: job.instruction, startTime, endTime,
        durationMs, status: 'failed', error: errorMsg,
      });
      this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: 'failed', error: errorMsg, durationMs });
      logger.error(`后台任务异常: ${job.name} (taskId=${taskId}), error="${errorMsg}"`);
    } finally {
      clearTimeout(timeoutHandle);
      this.debouncePersist();
      this.cleanupOldRuns();
    }
  }

  // ──────────── 结果广播 (事件总线) ────────────

  /**
   * 通过 PluginEventBus 广播定时任务执行结果
   *
   * 各平台（Console、Telegram、Web 等）自行订阅 'cron:result' 事件。
   * 无人监听时仅静默忽略。
   */
  private fireCronResult(payload: CronResultPayload): void {
    if (!this.eventBus) return;
    try {
      if (typeof this.eventBus.fire === 'function') {
        this.eventBus.fire('cron:result', payload);
      } else {
        this.eventBus.emit('cron:result', payload);
      }
    } catch (err) {
      logger.warn(`广播 cron:result 事件失败: ${err}`);
    }
  }

  // ──────────── 执行记录持久化 ────────────

  /**
   * 保存一条执行记录到 cron-runs/ 目录
   *
   * 文件名格式：<jobId>_<timestamp>.json
   */
  private saveRunRecord(record: CronRunRecord): void {
    try {
      if (!fs.existsSync(this.runsDir)) {
        fs.mkdirSync(this.runsDir, { recursive: true });
      }
      const filename = `${record.jobId}_${record.startTime}.json`;
      const filePath = path.join(this.runsDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`保存执行记录失败: ${err}`);
    }
  }

  /**
   * 清理过期的执行记录
   *
   * 清理策略：超过 retentionDays 或总数超过 retentionCount 的记录被删除。
   */
  private cleanupOldRuns(): void {
    try {
      if (!fs.existsSync(this.runsDir)) return;

      const files = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort(); // 按文件名（含时间戳）排序

      const now = Date.now();
      const retentionMs = this.backgroundConfig.retentionDays * 24 * 60 * 60 * 1000;
      let deleted = 0;

      // 先按时间清理
      for (const file of files) {
        // 从文件名提取时间戳：<jobId>_<timestamp>.json
        const match = file.match(/_([\d]+)\.json$/);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          if (now - timestamp > retentionMs) {
            try {
              fs.unlinkSync(path.join(this.runsDir, file));
              deleted++;
            } catch { /* 忽略单文件删除失败 */ }
          }
        }
      }

      // 再按数量清理（删除最早的）
      const remaining = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      if (remaining.length > this.backgroundConfig.retentionCount) {
        const toDelete = remaining.slice(0, remaining.length - this.backgroundConfig.retentionCount);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(path.join(this.runsDir, file));
            deleted++;
          } catch { /* 忽略 */ }
        }
      }

      if (deleted > 0) {
        logger.info(`清理了 ${deleted} 条过期执行记录`);
      }
    } catch (err) {
      logger.warn(`清理执行记录失败: ${err}`);
    }
  }

  /**
   * 获取执行记录列表（按时间倒序）
   *
   * 供 Web API 端点调用。
   */
  listRuns(limit: number = 50): CronRunRecord[] {
    try {
      if (!fs.existsSync(this.runsDir)) return [];

      const files = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse() // 最新的在前
        .slice(0, limit);

      const records: CronRunRecord[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), 'utf-8');
          records.push(JSON.parse(raw));
        } catch { /* 忽略解析失败的文件 */ }
      }
      return records;
    } catch {
      return [];
    }
  }

  /**
   * 获取单条执行记录
   *
   * @param runId 执行记录 ID（即 taskId）
   */
  getRunRecord(runId: string): CronRunRecord | null {
    try {
      if (!fs.existsSync(this.runsDir)) return null;

      // 遍历查找包含该 runId 的记录文件
      const files = fs.readdirSync(this.runsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), 'utf-8');
          const record: CronRunRecord = JSON.parse(raw);
          if (record.runId === runId) return record;
        } catch { /* 忽略 */ }
      }
      return null;
    } catch {
      return null;
    }
  }



  // ──────────── 持久化 ────────────

  /**
   * 防抖持久化：500ms 内的多次调用合并为一次实际写入
   */
  private debouncePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistSync();
      this.persistTimer = null;
    }, 500);
  }

  /**
   * 同步写入持久化文件
   * 将内存中的 jobs Map 序列化为 JSON 写入 cron-jobs.json
   *
   * 写入前检查文件是否被外部修改过（mtime 比较）。
   * 如果检测到外部修改，先调用 onFileChanged() 同步外部变更到内存，再写入。
   */
  private persistSync(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入前检测外部修改：如果文件的 mtime 比我们上次记录的更新，
      // 说明有外部编辑（用户手动修改、其他进程写入等）。
      // 必须先同步外部变更到内存，否则盲写会覆盖外部修改。
      if (fs.existsSync(this.filePath)) {
        try {
          const stat = fs.statSync(this.filePath);
          if (stat.mtimeMs > this.lastFileModTime) {
            this.onFileChanged();
          }
        } catch { /* stat 失败时跳过检测，继续写入 */ }
      }

      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');

      // 记录写入后的修改时间，避免 fs.watchFile 自触发
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略 stat 失败
      }
    } catch (err) {
      logger.error(`持久化写入失败: ${err}`);
    }
  }

  /**
   * 从持久化文件加载任务到内存
   * 文件不存在或解析失败时静默跳过。
   */
  private loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info('持久化文件不存在，从空白状态启动');
        return;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: ScheduledJob[] = JSON.parse(raw);

      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
        this.jobs.set(job.id, job);
      }

      // 记录当前文件修改时间
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略
      }

      logger.info(`从文件恢复了 ${parsed.length} 个任务`);
    } catch (err) {
      logger.error(`从文件加载任务失败: ${err}`);
    }
  }

  // ──────────── 文件监听 ────────────

  /**
   * 启动 fs.watchFile 文件轮询监听（间隔 2 秒）
   * 检测到外部修改时调用 onFileChanged 进行增量同步。
   */
  private startFileWatcher(): void {
    try {
      fs.watchFile(this.filePath, { interval: 2000 }, (curr) => {
        // 仅当文件修改时间晚于上次已知时间时才触发同步
        if (curr.mtimeMs > this.lastFileModTime) {
          this.onFileChanged();
        }
      });
      this.fileWatcherActive = true;
    } catch (err) {
      logger.warn(`启动文件监听失败: ${err}`);
    }
  }

  /** 停止文件监听 */
  private stopFileWatcher(): void {
    if (this.fileWatcherActive) {
      try {
        fs.unwatchFile(this.filePath);
      } catch {
        // 忽略
      }
      this.fileWatcherActive = false;
    }
  }

  /**
   * 文件变更回调：读取文件内容，与内存做 diff，增量同步
   *
   * 处理三种情况：
   * - 文件中有而内存中没有的任务 → 新增
   * - 文件中有且内容不同的任务 → 更新
   * - 内存中有而文件中没有的任务 → 删除
   */
  private shouldRescheduleAfterFileSync(existing: ScheduledJob, incoming: ScheduledJob): boolean {
    // 文件同步时，只有“调度相关字段”变化才应该清定时器并重新排程。
    // lastRunStatus / lastRunAt / lastRunError 属于运行时状态，它们变化时如果也重排定时器，
    // 会把同一次执行重新排出一个新 timer，进而造成重复触发。
    return (
      existing.enabled !== incoming.enabled
      || JSON.stringify(existing.schedule) !== JSON.stringify(incoming.schedule)
    );
  }

  private syncJobInPlace(target: ScheduledJob, source: ScheduledJob): void {
    // 不直接替换 Map 里的对象，而是原地同步。
    // 原因：定时器回调、后台执行流程、以及其他引用都可能还持有这个对象。
    // 如果直接 this.jobs.set(id, source)，旧引用上的 running 状态就与新对象脱节，
    // 最终会出现“一个任务被不同对象各自执行一遍”的并发错误。

    // 先删除 source 中已经不存在的可选字段，避免旧错误信息残留。
    for (const key of Object.keys(target) as Array<keyof ScheduledJob>) {
      if (!(key in source)) {
        delete (target as unknown as Record<string, unknown>)[key as string];
      }
    }

    Object.assign(target, source);
  }

  private onFileChanged(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: ScheduledJob[] = JSON.parse(raw);

      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
      }

      // 更新已知修改时间
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略
      }

      const newIds = new Set(parsed.map((j) => j.id));
      const currentIds = new Set(this.jobs.keys());

      // 删除：内存中有但文件中没有的任务
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          this.clearTimer(id);
          this.jobs.delete(id);
          logger.info(`文件同步: 删除任务 ${id}`);
        }
      }

      // 新增或更新
      for (const job of parsed) {
        const existing = this.jobs.get(job.id);
        if (!existing) {
          // 新增
          this.jobs.set(job.id, job);
          if (job.enabled) this.scheduleNext(job);
          logger.info(`文件同步: 新增任务 ${job.name} (${job.id})`);
        } else {
          // 对比序列化后的字符串来检测是否有变化
          const shouldReschedule = this.shouldRescheduleAfterFileSync(existing, job);
          const existingStr = JSON.stringify(existing);
          const newStr = JSON.stringify(job);
          if (existingStr !== newStr) {
            // 原地同步，保持所有闭包和执行路径都指向同一个权威对象。
            this.syncJobInPlace(existing, job);

            // 只有调度相关字段变化时才重排定时器。
            if (shouldReschedule) {
              this.clearTimer(existing.id);
              // 如果任务当前正在执行，就不要在文件同步阶段立刻补排新 timer，
              // 留给后台执行 finally 中的“缺定时器兜底补排”处理，避免并发竞争。
              if (existing.enabled && !this.executingJobIds.has(existing.id) && this.running) {
                this.scheduleNext(existing);
              }
            }
            logger.info(`文件同步: 更新任务 ${job.name} (${job.id})`);
          }
        }
      }

      logger.info(`文件同步完成，当前共 ${this.jobs.size} 个任务`);
    } catch (err) {
      logger.error(`文件同步失败: ${err}`);
    }
  }

  // ──────────── 内部辅助 ────────────

  /** 清除指定任务的 setTimeout 定时器 */
  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
