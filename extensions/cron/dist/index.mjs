// src/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/scheduler.ts
import * as fs from "fs";
import * as path from "path";

// src/types.ts
var DEFAULT_SCHEDULER_CONFIG = {
  enabled: true,
  quietHours: {
    enabled: false,
    windows: [{ start: "23:00", end: "07:00" }],
    allowUrgent: true
  },
  skipIfRecentActivity: {
    enabled: true,
    withinMinutes: 5
  }
};
var DEFAULT_BACKGROUND_CONFIG = {
  timeoutMs: 5 * 60 * 1000,
  maxConcurrent: 3,
  retentionDays: 30,
  retentionCount: 100,
  maxToolRounds: 15
};

// src/delivery-gate.ts
function parseTimeToMinutes(time) {
  const parts = time.split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`无效的时间格式: "${time}"，应为 HH:MM`);
  }
  return hours * 60 + minutes;
}
function isInTimeWindow(now, window) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
function isInQuietHours(config, now) {
  if (!config.quietHours.enabled)
    return false;
  for (const window of config.quietHours.windows) {
    if (isInTimeWindow(now, window)) {
      return true;
    }
  }
  return false;
}
function hasRecentActivity(config, sessionId, lastActivityMap, now) {
  if (!config.skipIfRecentActivity.enabled)
    return false;
  const lastActivity = lastActivityMap.get(sessionId);
  if (lastActivity === undefined)
    return false;
  const thresholdMs = config.skipIfRecentActivity.withinMinutes * 60 * 1000;
  return now - lastActivity < thresholdMs;
}
function shouldSkip(job, config, lastActivityMap, now) {
  const currentDate = now ?? new Date;
  const currentTimestamp = currentDate.getTime();
  if (!job.enabled) {
    return { skip: true, reason: `任务 "${job.name}" 已禁用` };
  }
  if (isInQuietHours(config, currentDate)) {
    if (job.urgent && config.quietHours.allowUrgent) {} else {
      return {
        skip: true,
        reason: `当前处于安静时段，任务 "${job.name}" 被跳过`
      };
    }
  }
  const targetSessionId = job.delivery.sessionId ?? job.sessionId;
  if (hasRecentActivity(config, targetSessionId, lastActivityMap, currentTimestamp)) {
    return {
      skip: true,
      reason: `会话 ${targetSessionId} 在 ${config.skipIfRecentActivity.withinMinutes} 分钟内有活动，跳过任务 "${job.name}"`
    };
  }
  return { skip: false };
}

// src/scheduler.ts
var logger = createPluginLogger("cron");
function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function parseCronField(field, min, max) {
  const values = new Set;
  const segments = field.split(",");
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.includes("/")) {
      const [rangePart, stepStr] = trimmed.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`无效的步进值: "${trimmed}"`);
      }
      let start = min;
      let end = max;
      if (rangePart !== "*") {
        if (rangePart.includes("-")) {
          const [rs, re] = rangePart.split("-");
          start = parseInt(rs, 10);
          end = parseInt(re, 10);
        } else {
          start = parseInt(rangePart, 10);
        }
      }
      for (let i = start;i <= end; i += step) {
        values.add(i);
      }
    } else if (trimmed.includes("-")) {
      const [rs, re] = trimmed.split("-");
      const start = parseInt(rs, 10);
      const end = parseInt(re, 10);
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`无效的范围: "${trimmed}"`);
      }
      for (let i = start;i <= end; i++) {
        values.add(i);
      }
    } else if (trimmed === "*") {
      for (let i = min;i <= max; i++) {
        values.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) {
        throw new Error(`无效的 cron 字段值: "${trimmed}"`);
      }
      values.add(num);
    }
  }
  return { values };
}
function parseCronExpression(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron 表达式必须包含 5 个字段（分 时 日 月 周），实际收到 ${fields.length} 个字段: "${expression}"`);
  }
  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 6)
  };
}
function matchesCron(parsed, date) {
  return parsed.minute.values.has(date.getMinutes()) && parsed.hour.values.has(date.getHours()) && parsed.dayOfMonth.values.has(date.getDate()) && parsed.month.values.has(date.getMonth() + 1) && parsed.dayOfWeek.values.has(date.getDay());
}
function getNextCronTime(expression, after) {
  const parsed = parseCronExpression(expression);
  const cursor = after ? new Date(after.getTime()) : new Date;
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const maxIterations = 527040;
  for (let i = 0;i < maxIterations; i++) {
    if (matchesCron(parsed, cursor)) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error(`在 366 天内未找到匹配的 cron 触发时间: "${expression}"`);
}
var CRON_SYSTEM_PROMPT = `你是一个自动化定时任务执行器。

你的职责是执行用户预设的定时任务指令，完成后输出简洁的执行报告。

注意事项：
- 你在后台独立运行，没有用户正在与你对话
- 你的输出将作为通知推送给用户，请保持简洁明了
- 如果任务涉及文件操作，请使用可用的工具完成
- 完成后直接给出结论，不需要寒暄或确认`;
var cronTaskCounter = 0;
function createCronTaskId() {
  return `cron_task_${++cronTaskCounter}_${Date.now()}`;
}
function normalizeRunStatus(status) {
  if (!status)
    return;
  if (status === "success")
    return "completed";
  return status;
}

class CronScheduler {
  jobs = new Map;
  timers = new Map;
  lastActivityMap = new Map;
  config;
  filePath;
  api;
  persistTimer = null;
  fileWatcherActive = false;
  lastFileModTime = 0;
  running = false;
  agentTaskRegistry = null;
  eventBus = null;
  backgroundConfig;
  runsDir;
  activeBackgroundCount = 0;
  executingJobIds = new Set;
  constructor(api, config, agentTaskRegistry, eventBus, backgroundConfig) {
    this.api = api;
    this.config = config ? { ...config } : { ...DEFAULT_SCHEDULER_CONFIG };
    this.agentTaskRegistry = agentTaskRegistry ?? null;
    this.eventBus = eventBus ?? null;
    this.backgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG, ...backgroundConfig };
    const dataDir = api.dataDir ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".iris");
    this.filePath = path.join(dataDir, "cron-jobs.json");
    this.runsDir = path.join(dataDir, "cron-runs");
  }
  async start() {
    if (this.running)
      return;
    this.running = true;
    this.loadFromFile();
    this.reconcileJobsOnStartup();
    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.scheduleNext(job);
      }
    }
    this.startFileWatcher();
    logger.info(`调度器已启动，共 ${this.jobs.size} 个任务`);
  }
  stop() {
    this.running = false;
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.stopFileWatcher();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistSync();
    logger.info("调度器已停止");
  }
  createJob(params) {
    const job = {
      id: generateId(),
      name: params.name,
      schedule: params.schedule,
      sessionId: params.sessionId,
      instruction: params.instruction,
      delivery: {
        sessionId: params.delivery?.sessionId,
        fallback: params.delivery?.fallback ?? "last-active"
      },
      silent: params.silent ?? false,
      urgent: params.urgent ?? false,
      enabled: true,
      createdAt: Date.now(),
      createdInSession: params.createdInSession
    };
    this.jobs.set(job.id, job);
    if (job.enabled) {
      this.scheduleNext(job);
    }
    this.debouncePersist();
    logger.info(`任务已创建: ${job.name} (${job.id})`);
    return job;
  }
  updateJob(id, params) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    if (params.name !== undefined)
      job.name = params.name;
    if (params.schedule !== undefined)
      job.schedule = params.schedule;
    if (params.instruction !== undefined)
      job.instruction = params.instruction;
    if (params.delivery !== undefined) {
      job.delivery = { ...job.delivery, ...params.delivery };
    }
    if (params.silent !== undefined)
      job.silent = params.silent;
    if (params.urgent !== undefined)
      job.urgent = params.urgent;
    this.clearTimer(id);
    if (job.enabled) {
      this.scheduleNext(job);
    }
    this.debouncePersist();
    logger.info(`任务已更新: ${job.name} (${id})`);
    return job;
  }
  deleteJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return false;
    this.clearTimer(id);
    this.jobs.delete(id);
    this.debouncePersist();
    logger.info(`任务已删除: ${job.name} (${id})`);
    return true;
  }
  enableJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    if (job.schedule.type === "once" && job.schedule.at - Date.now() <= 0) {
      logger.warn(`拒绝启用已过期的一次性任务: ${job.name} (${id}), ` + `原定时间=${new Date(job.schedule.at).toISOString()}`);
      return null;
    }
    job.enabled = true;
    this.scheduleNext(job);
    this.debouncePersist();
    logger.info(`任务已启用: ${job.name} (${id})`);
    return job;
  }
  disableJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    job.enabled = false;
    this.clearTimer(id);
    this.debouncePersist();
    logger.info(`任务已禁用: ${job.name} (${id})`);
    return job;
  }
  getJob(id) {
    return this.jobs.get(id);
  }
  listJobs() {
    return Array.from(this.jobs.values());
  }
  getConfig() {
    return this.config;
  }
  updateConfig(newConfig) {
    if (newConfig.enabled !== undefined) {
      this.config.enabled = newConfig.enabled;
    }
    if (newConfig.quietHours) {
      this.config.quietHours = {
        ...this.config.quietHours,
        ...newConfig.quietHours
      };
    }
    if (newConfig.skipIfRecentActivity) {
      this.config.skipIfRecentActivity = {
        ...this.config.skipIfRecentActivity,
        ...newConfig.skipIfRecentActivity
      };
    }
    logger.info("调度器配置已热更新");
  }
  recordActivity(sessionId) {
    this.lastActivityMap.set(sessionId, Date.now());
  }
  reconcileJobsOnStartup() {
    let changed = false;
    for (const job of this.jobs.values()) {
      if (job.lastRunStatus === "running") {
        job.lastRunStatus = "error";
        job.lastRunError = "进程重启前任务仍在执行中（僵尸任务恢复）";
        if (job.schedule.type === "once") {
          job.enabled = false;
        }
        changed = true;
        logger.warn(`僵尸任务恢复: ${job.name} (${job.id}), type=${job.schedule.type}`);
        continue;
      }
      if (job.schedule.type !== "once")
        continue;
      const isExpired = job.schedule.at - Date.now() <= 0;
      if (isExpired && (job.lastRunStatus === "completed" || job.lastRunStatus === "success" || job.lastRunStatus === "error" || job.lastRunStatus === "missed")) {
        if (job.enabled) {
          job.enabled = false;
          changed = true;
          logger.info(`一次性任务已完结，确保禁用: ${job.name} (${job.id}), status=${job.lastRunStatus}`);
        }
        continue;
      }
      if (isExpired) {
        job.lastRunStatus = "missed";
        job.lastRunAt = Date.now();
        job.enabled = false;
        changed = true;
        logger.warn(`一次性任务已过期，标记为 missed: ${job.name} (${job.id})`);
        continue;
      }
    }
    if (changed) {
      this.debouncePersist();
    }
  }
  scheduleNext(job) {
    this.clearTimer(job.id);
    const jobId = job.id;
    if (!job.enabled || !this.running)
      return;
    let delayMs;
    switch (job.schedule.type) {
      case "cron": {
        try {
          const nextTime = getNextCronTime(job.schedule.expression);
          delayMs = nextTime.getTime() - Date.now();
        } catch (err) {
          logger.error(`计算 cron 下次触发时间失败 (${job.name}): ${err}`);
          return;
        }
        break;
      }
      case "interval": {
        delayMs = job.schedule.ms;
        break;
      }
      case "once": {
        delayMs = job.schedule.at - Date.now();
        if (delayMs <= 0) {
          logger.debug(`一次性任务已过期，跳过调度: ${job.name} (${job.id})`);
          return;
        }
        break;
      }
    }
    const timer = setTimeout(() => {
      this.timers.delete(jobId);
      const currentJob = this.jobs.get(jobId);
      if (!currentJob)
        return;
      this.executeJob(currentJob);
    }, delayMs);
    if (timer.unref) {
      timer.unref();
    }
    this.timers.set(job.id, timer);
  }
  async executeJob(job) {
    const currentJob = this.jobs.get(job.id) ?? job;
    if (this.executingJobIds.has(currentJob.id)) {
      logger.info(`任务正在执行中，跳过本次触发: ${currentJob.name} (${currentJob.id})`);
      return;
    }
    if (currentJob.lastRunStatus === "running") {
      logger.info(`任务状态仍为 running，跳过本次触发: ${currentJob.name} (${currentJob.id})`);
      return;
    }
    const decision = shouldSkip(currentJob, this.config, this.lastActivityMap);
    if (decision.skip) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = "skipped";
      if (currentJob.schedule.type === "once") {
        currentJob.enabled = false;
      }
      logger.info(`任务被跳过: ${currentJob.name} — ${decision.reason}`);
      this.debouncePersist();
      if (currentJob.schedule.type !== "once") {
        this.scheduleNext(currentJob);
      }
      return;
    }
    if (currentJob.schedule.type !== "once") {
      this.scheduleNext(currentJob);
    }
    if (this.activeBackgroundCount >= this.backgroundConfig.maxConcurrent) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = "skipped";
      currentJob.lastRunError = `并发后台任务数已达上限 (${this.backgroundConfig.maxConcurrent})`;
      if (currentJob.schedule.type === "once") {
        currentJob.enabled = false;
      }
      logger.warn(`任务被跳过（并发上限）: ${currentJob.name}`);
      this.debouncePersist();
      return;
    }
    if (!this.agentTaskRegistry) {
      this.executeJobLegacy(currentJob);
      return;
    }
    const taskId = createCronTaskId();
    const virtualSessionId = `cron:${currentJob.id}`;
    const description = `定时任务: ${currentJob.name}`;
    const task = this.agentTaskRegistry.register(taskId, virtualSessionId, description);
    currentJob.lastRunAt = Date.now();
    currentJob.lastRunStatus = "running";
    if (currentJob.schedule.type === "once") {
      currentJob.enabled = false;
    }
    this.debouncePersist();
    this.executingJobIds.add(currentJob.id);
    this.activeBackgroundCount++;
    this.runCronJobInBackground(currentJob, taskId, task.abortController?.signal).finally(() => {
      this.activeBackgroundCount--;
      this.executingJobIds.delete(currentJob.id);
      if (currentJob.schedule.type !== "once" && currentJob.enabled && !this.timers.has(currentJob.id) && this.running) {
        this.scheduleNext(currentJob);
      }
    });
    logger.info(`后台任务已启动: ${currentJob.name} (taskId=${taskId})`);
  }
  executeJobLegacy(job) {
    try {
      const targetSessionId = job.delivery.sessionId ?? job.sessionId;
      if (job.schedule.type === "once") {
        job.enabled = false;
      }
      let instruction = job.instruction;
      if (job.silent) {
        instruction = `如果没有值得报告的内容，不要发送任何消息。
` + instruction;
      }
      const xml = `<task-notification task-id="${job.id}" task-name="${job.name}">${instruction}</task-notification>`;
      const backend = this.api.backend;
      if (typeof backend.enqueueAgentNotification === "function") {
        backend.enqueueAgentNotification(targetSessionId, xml);
        job.lastRunAt = Date.now();
        job.lastRunStatus = "completed";
        logger.info(`任务已投递（旧方式）: ${job.name} → 会话 ${targetSessionId}`);
      } else {
        throw new Error("backend.enqueueAgentNotification 方法不可用");
      }
    } catch (err) {
      job.lastRunAt = Date.now();
      job.lastRunStatus = "error";
      job.lastRunError = err instanceof Error ? err.message : String(err);
      logger.error(`任务执行失败: ${job.name} — ${err}`);
    }
    this.debouncePersist();
  }
  async runCronJobInBackground(job, taskId, signal) {
    const startTime = Date.now();
    const registry = this.agentTaskRegistry;
    const timeoutHandle = setTimeout(() => {
      registry.kill(taskId);
      logger.warn(`后台任务超时 (${this.backgroundConfig.timeoutMs}ms): ${job.name}`);
    }, this.backgroundConfig.timeoutMs);
    if (timeoutHandle.unref)
      timeoutHandle.unref();
    try {
      const excludedTools = ["sub_agent", "history_search", "manage_scheduled_tasks"];
      const cronTools = this.api.tools.createFiltered?.(excludedTools) ?? this.api.tools;
      let systemPrompt = CRON_SYSTEM_PROMPT;
      if (job.silent) {
        systemPrompt += "\n- 如果没有值得报告的内容，请回复 `[no-report]`。";
      }
      if (typeof this.api.createToolLoop !== "function") {
        throw new Error("IrisAPI.createToolLoop 不可用，无法执行后台任务");
      }
      const toolLoop = this.api.createToolLoop({
        tools: cronTools,
        systemPrompt,
        maxRounds: this.backgroundConfig.maxToolRounds
      });
      const router = this.api.router;
      const callLLM = async (request, modelName, sig) => {
        if (router.chatStream) {
          const parts = [];
          let usageMetadata;
          for await (const chunk of router.chatStream(request, modelName, sig)) {
            registry.emitChunkHeartbeat(taskId);
            if (chunk.partsDelta && chunk.partsDelta.length > 0) {
              for (const part of chunk.partsDelta) {
                parts.push(part);
              }
            } else {
              if (chunk.textDelta)
                parts.push({ text: chunk.textDelta });
              if (chunk.functionCalls) {
                for (const fc of chunk.functionCalls)
                  parts.push(fc);
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
          if (parts.length === 0)
            parts.push({ text: "" });
          const content = { role: "model", parts, createdAt: Date.now() };
          if (usageMetadata)
            content.usageMetadata = usageMetadata;
          return content;
        }
        if (!router.chat) {
          throw new Error("LLMRouter 既不支持 chatStream 也不支持 chat，无法调用 LLM");
        }
        const response = await router.chat(request, modelName, sig);
        return response.content;
      };
      const history = [];
      let userInstruction = job.instruction;
      if (job.silent) {
        userInstruction = "如果没有值得报告的内容，请回复 `[no-report]`。\n" + userInstruction;
      }
      history.push({ role: "user", parts: [{ text: userInstruction }] });
      const result = await toolLoop.run(history, callLLM, { signal });
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const finalText = result.text ?? "";
      const loopError = result.error;
      if (result.aborted) {
        registry.kill(taskId);
        job.lastRunStatus = "error";
        job.lastRunError = "后台任务被中止";
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "killed"
        });
        this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: "killed", durationMs });
        logger.info(`后台任务被中止: ${job.name} (taskId=${taskId})`);
      } else if (loopError) {
        registry.fail(taskId, loopError);
        job.lastRunStatus = "error";
        job.lastRunError = loopError;
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "failed",
          error: loopError
        });
        this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: "failed", error: loopError, durationMs });
        logger.error(`后台任务失败: ${job.name} (taskId=${taskId}), error="${loopError}"`);
      } else {
        const isSilentNoReport = job.silent && finalText.includes("[no-report]");
        registry.complete(taskId, finalText);
        job.lastRunStatus = "completed";
        job.lastRunError = undefined;
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "completed",
          resultText: finalText
        });
        if (!isSilentNoReport) {
          this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: "completed", result: finalText, durationMs });
        }
        logger.info(`后台任务完成: ${job.name} (taskId=${taskId}), duration=${durationMs}ms, silent_skip=${isSilentNoReport}`);
      }
    } catch (err) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      registry.fail(taskId, errorMsg);
      job.lastRunStatus = "error";
      job.lastRunError = errorMsg;
      this.saveRunRecord({
        runId: taskId,
        jobId: job.id,
        jobName: job.name,
        instruction: job.instruction,
        startTime,
        endTime,
        durationMs,
        status: "failed",
        error: errorMsg
      });
      this.fireCronResult({ jobId: job.id, taskId, jobName: job.name, status: "failed", error: errorMsg, durationMs });
      logger.error(`后台任务异常: ${job.name} (taskId=${taskId}), error="${errorMsg}"`);
    } finally {
      clearTimeout(timeoutHandle);
      this.debouncePersist();
      this.cleanupOldRuns();
    }
  }
  fireCronResult(payload) {
    if (!this.eventBus)
      return;
    try {
      if (typeof this.eventBus.fire === "function") {
        this.eventBus.fire("cron:result", payload);
      } else {
        this.eventBus.emit("cron:result", payload);
      }
    } catch (err) {
      logger.warn(`广播 cron:result 事件失败: ${err}`);
    }
  }
  saveRunRecord(record) {
    try {
      if (!fs.existsSync(this.runsDir)) {
        fs.mkdirSync(this.runsDir, { recursive: true });
      }
      const filename = `${record.jobId}_${record.startTime}.json`;
      const filePath = path.join(this.runsDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
    } catch (err) {
      logger.warn(`保存执行记录失败: ${err}`);
    }
  }
  cleanupOldRuns() {
    try {
      if (!fs.existsSync(this.runsDir))
        return;
      const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json")).sort();
      const now = Date.now();
      const retentionMs = this.backgroundConfig.retentionDays * 24 * 60 * 60 * 1000;
      let deleted = 0;
      for (const file of files) {
        const match = file.match(/_([\d]+)\.json$/);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          if (now - timestamp > retentionMs) {
            try {
              fs.unlinkSync(path.join(this.runsDir, file));
              deleted++;
            } catch {}
          }
        }
      }
      const remaining = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json")).sort();
      if (remaining.length > this.backgroundConfig.retentionCount) {
        const toDelete = remaining.slice(0, remaining.length - this.backgroundConfig.retentionCount);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(path.join(this.runsDir, file));
            deleted++;
          } catch {}
        }
      }
      if (deleted > 0) {
        logger.info(`清理了 ${deleted} 条过期执行记录`);
      }
    } catch (err) {
      logger.warn(`清理执行记录失败: ${err}`);
    }
  }
  listRuns(limit = 50) {
    try {
      if (!fs.existsSync(this.runsDir))
        return [];
      const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
      const records = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), "utf-8");
          records.push(JSON.parse(raw));
        } catch {}
      }
      return records;
    } catch {
      return [];
    }
  }
  getRunRecord(runId) {
    try {
      if (!fs.existsSync(this.runsDir))
        return null;
      const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), "utf-8");
          const record = JSON.parse(raw);
          if (record.runId === runId)
            return record;
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  }
  debouncePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistSync();
      this.persistTimer = null;
    }, 500);
  }
  persistSync() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        try {
          const stat = fs.statSync(this.filePath);
          if (stat.mtimeMs > this.lastFileModTime) {
            this.onFileChanged();
          }
        } catch {}
      }
      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      fs.writeFileSync(this.filePath, data, "utf-8");
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
    } catch (err) {
      logger.error(`持久化写入失败: ${err}`);
    }
  }
  loadFromFile() {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info("持久化文件不存在，从空白状态启动");
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
        this.jobs.set(job.id, job);
      }
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
      logger.info(`从文件恢复了 ${parsed.length} 个任务`);
    } catch (err) {
      logger.error(`从文件加载任务失败: ${err}`);
    }
  }
  startFileWatcher() {
    try {
      fs.watchFile(this.filePath, { interval: 2000 }, (curr) => {
        if (curr.mtimeMs > this.lastFileModTime) {
          this.onFileChanged();
        }
      });
      this.fileWatcherActive = true;
    } catch (err) {
      logger.warn(`启动文件监听失败: ${err}`);
    }
  }
  stopFileWatcher() {
    if (this.fileWatcherActive) {
      try {
        fs.unwatchFile(this.filePath);
      } catch {}
      this.fileWatcherActive = false;
    }
  }
  shouldRescheduleAfterFileSync(existing, incoming) {
    return existing.enabled !== incoming.enabled || JSON.stringify(existing.schedule) !== JSON.stringify(incoming.schedule);
  }
  syncJobInPlace(target, source) {
    for (const key of Object.keys(target)) {
      if (!(key in source)) {
        delete target[key];
      }
    }
    Object.assign(target, source);
  }
  onFileChanged() {
    try {
      if (!fs.existsSync(this.filePath))
        return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
      }
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
      const newIds = new Set(parsed.map((j) => j.id));
      const currentIds = new Set(this.jobs.keys());
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          this.clearTimer(id);
          this.jobs.delete(id);
          logger.info(`文件同步: 删除任务 ${id}`);
        }
      }
      for (const job of parsed) {
        const existing = this.jobs.get(job.id);
        if (!existing) {
          this.jobs.set(job.id, job);
          if (job.enabled)
            this.scheduleNext(job);
          logger.info(`文件同步: 新增任务 ${job.name} (${job.id})`);
        } else {
          const shouldReschedule = this.shouldRescheduleAfterFileSync(existing, job);
          const existingStr = JSON.stringify(existing);
          const newStr = JSON.stringify(job);
          if (existingStr !== newStr) {
            this.syncJobInPlace(existing, job);
            if (shouldReschedule) {
              this.clearTimer(existing.id);
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
  clearTimer(id) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

// src/tool.ts
var logger2 = createPluginLogger("cron", "tool");
var scheduler = null;
var currentSessionId = "default";
function injectScheduler(s) {
  scheduler = s;
}
function setCurrentSessionId(sid) {
  currentSessionId = sid;
}
var manageScheduledTasksTool = {
  declaration: {
    name: "manage_scheduled_tasks",
    description: `管理定时调度任务。支持创建（create）、更新（update）、删除（delete）、启用（enable）、禁用（disable）、列出（list）和查询（get）定时任务。
` + `调度模式：cron（cron 表达式，如 "0 9 * * 1-5" 表示工作日每天早上9点）、interval（固定间隔毫秒数）、once（一次性 Unix 时间戳）。
` + "任务触发后会在后台独立拉起一个 agent 执行预设的 instruction 指令（拥有独立的工具调用能力），" + "执行完成后将结果报告推送到所有已启动的前端平台，不占用当前对话。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "delete", "enable", "disable", "list", "get"],
          description: "操作类型"
        },
        name: {
          type: "string",
          description: "任务名称（create / update 时使用）"
        },
        schedule_type: {
          type: "string",
          enum: ["cron", "interval", "once"],
          description: "调度类型（create / update 时使用）"
        },
        schedule_value: {
          type: "string",
          description: '调度参数值：cron 表达式（如 "0 9 * * 1-5"）/ 间隔毫秒数（如 "60000"）/ Unix 时间戳（如 "1700000000000"）'
        },
        instruction: {
          type: "string",
          description: "任务触发时发送给 LLM 的指令文本"
        },
        silent: {
          type: "boolean",
          description: "静默模式：如果没有值得报告的内容则不发送消息"
        },
        urgent: {
          type: "boolean",
          description: "紧急任务：可穿透安静时段限制"
        },
        job_id: {
          type: "string",
          description: "任务 ID（update / delete / enable / disable / get 时使用）"
        }
      },
      required: ["action"]
    }
  },
  parallel: false,
  handler: async (args) => {
    if (!scheduler) {
      return { error: "调度器尚未初始化，请稍后重试" };
    }
    const action = args.action;
    switch (action) {
      case "create": {
        const name = args.name;
        const scheduleType = args.schedule_type;
        const scheduleValue = args.schedule_value;
        const instruction = args.instruction;
        if (!name || !scheduleType || !scheduleValue || !instruction) {
          return {
            error: "create 操作需要以下参数：name, schedule_type, schedule_value, instruction"
          };
        }
        let schedule;
        switch (scheduleType) {
          case "cron":
            schedule = { type: "cron", expression: scheduleValue };
            break;
          case "interval": {
            const ms = parseInt(scheduleValue, 10);
            if (isNaN(ms) || ms <= 0) {
              return { error: `无效的间隔值: "${scheduleValue}"，应为正整数毫秒数` };
            }
            schedule = { type: "interval", ms };
            break;
          }
          case "once": {
            const at = parseInt(scheduleValue, 10);
            if (isNaN(at) || at <= 0) {
              return { error: `无效的时间戳: "${scheduleValue}"，应为正整数 Unix 时间戳` };
            }
            schedule = { type: "once", at };
            break;
          }
          default:
            return { error: `不支持的调度类型: "${scheduleType}"` };
        }
        const params = {
          name,
          schedule,
          sessionId: currentSessionId,
          instruction,
          delivery: {
            sessionId: currentSessionId,
            fallback: "last-active"
          },
          silent: args.silent ?? false,
          urgent: args.urgent ?? false,
          createdInSession: currentSessionId
        };
        const job = scheduler.createJob(params);
        logger2.info(`工具调用: 创建任务 "${job.name}" (${job.id})`);
        return {
          success: true,
          job: {
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            instruction: job.instruction,
            silent: job.silent,
            urgent: job.urgent,
            enabled: job.enabled,
            createdAt: new Date(job.createdAt).toISOString()
          }
        };
      }
      case "update": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "update 操作需要 job_id 参数" };
        }
        const updateParams = {};
        if (args.name !== undefined)
          updateParams.name = args.name;
        if (args.instruction !== undefined)
          updateParams.instruction = args.instruction;
        if (args.silent !== undefined)
          updateParams.silent = args.silent;
        if (args.urgent !== undefined)
          updateParams.urgent = args.urgent;
        if (args.schedule_type && args.schedule_value) {
          const st = args.schedule_type;
          const sv = args.schedule_value;
          switch (st) {
            case "cron":
              updateParams.schedule = { type: "cron", expression: sv };
              break;
            case "interval":
              updateParams.schedule = { type: "interval", ms: parseInt(sv, 10) };
              break;
            case "once":
              updateParams.schedule = { type: "once", at: parseInt(sv, 10) };
              break;
          }
        }
        const updated = scheduler.updateJob(jobId, updateParams);
        if (!updated) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger2.info(`工具调用: 更新任务 "${updated.name}" (${jobId})`);
        return { success: true, job: updated };
      }
      case "delete": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "delete 操作需要 job_id 参数" };
        }
        const deleted = scheduler.deleteJob(jobId);
        if (!deleted) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger2.info(`工具调用: 删除任务 ${jobId}`);
        return { success: true, message: `任务 ${jobId} 已删除` };
      }
      case "enable": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "enable 操作需要 job_id 参数" };
        }
        const enabled = scheduler.enableJob(jobId);
        if (!enabled) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger2.info(`工具调用: 启用任务 "${enabled.name}" (${jobId})`);
        return { success: true, job: enabled };
      }
      case "disable": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "disable 操作需要 job_id 参数" };
        }
        const disabled = scheduler.disableJob(jobId);
        if (!disabled) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger2.info(`工具调用: 禁用任务 "${disabled.name}" (${jobId})`);
        return { success: true, job: disabled };
      }
      case "list": {
        const jobs = scheduler.listJobs();
        return {
          success: true,
          count: jobs.length,
          jobs: jobs.map((j) => ({
            id: j.id,
            name: j.name,
            schedule: j.schedule,
            enabled: j.enabled,
            silent: j.silent,
            urgent: j.urgent,
            lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
            lastRunStatus: j.lastRunStatus ?? null
          }))
        };
      }
      case "get": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "get 操作需要 job_id 参数" };
        }
        const job = scheduler.getJob(jobId);
        if (!job) {
          return { error: `未找到任务: ${jobId}` };
        }
        return { success: true, job };
      }
      default:
        return { error: `不支持的操作类型: "${action}"` };
    }
  }
};

// src/index.ts
var logger3 = createPluginLogger("cron");
var schedulerInstance = null;
var src_default = definePlugin({
  name: "cron",
  version: "0.1.0",
  description: "定时任务调度插件 — Cron / Interval / Once 三种调度模式",
  activate(ctx) {
    const pluginConfig = ctx.getPluginConfig();
    const config = resolveConfig(pluginConfig);
    if (!config.enabled) {
      logger3.info("调度器未启用（config.enabled = false）");
      return;
    }
    ctx.registerTool(manageScheduledTasksTool);
    logger3.info("manage_scheduled_tasks 工具已注册");
    ctx.addHook({
      name: "cron:capture-session",
      priority: 200,
      onBeforeChat({ sessionId }) {
        setCurrentSessionId(sessionId);
        return;
      }
    });
    ctx.onReady(async (api) => {
      const agentTaskRegistry = api.agentTaskRegistry ?? null;
      const eventBus = (typeof ctx.getEventBus === "function" ? ctx.getEventBus() : null) ?? (api.eventBus ?? null);
      schedulerInstance = new CronScheduler(api, config, agentTaskRegistry, eventBus);
      injectScheduler(schedulerInstance);
      api.backend.on("done", (sessionId) => {
        schedulerInstance?.recordActivity(sessionId);
      });
      await schedulerInstance.start();
      registerWebRoutes(api);
      registerSettingsTab(api, ctx);
      logger3.info("调度器插件初始化完成");
    });
  },
  async deactivate() {
    if (schedulerInstance) {
      schedulerInstance.stop();
      schedulerInstance = null;
    }
    logger3.info("调度器插件已卸载");
  }
});
function registerWebRoutes(api) {
  if (!api.registerWebRoute) {
    logger3.info("Web 路由注册不可用（非 Web 平台），跳过");
    return;
  }
  api.registerWebRoute("GET", "/api/plugins/cron/jobs", async (_req, res) => {
    const jobs = schedulerInstance?.listJobs() ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, jobs }));
  });
  api.registerWebRoute("POST", "/api/plugins/cron/jobs/:id/toggle", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const job = schedulerInstance.getJob(params.id);
    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "任务不存在" }));
      return;
    }
    const result = job.enabled ? schedulerInstance.disableJob(params.id) : schedulerInstance.enableJob(params.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, job: result }));
  });
  api.registerWebRoute("DELETE", "/api/plugins/cron/jobs/:id", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const deleted = schedulerInstance.deleteJob(params.id);
    if (!deleted) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "任务不存在" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });
  api.registerWebRoute("GET", "/api/plugins/cron/runs", async (_req, res) => {
    const runs = schedulerInstance?.listRuns() ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, runs }));
  });
  api.registerWebRoute("GET", "/api/plugins/cron/runs/:runId", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const record = schedulerInstance.getRunRecord(params.runId);
    if (!record) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "执行记录不存在" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, record }));
  });
  logger3.info("Web API 路由已注册（5 个端点）");
}
function registerSettingsTab(api, ctx) {
  const registerTab = api.registerConsoleSettingsTab;
  if (!registerTab) {
    logger3.info("Console Settings Tab 注册不可用，跳过");
    return;
  }
  registerTab({
    id: "cron",
    label: "定时任务",
    icon: "⏰",
    fields: [
      {
        key: "enabled",
        label: "启用调度器",
        type: "toggle",
        defaultValue: true,
        description: "是否启用定时任务调度功能"
      },
      {
        key: "quietHoursEnabled",
        label: "启用安静时段",
        type: "toggle",
        defaultValue: false,
        description: "在安静时段内，非紧急任务将被跳过",
        group: "安静时段"
      },
      {
        key: "quietHoursStart",
        label: "开始时间",
        type: "text",
        defaultValue: "23:00",
        description: "安静时段开始时间（HH:MM 格式）",
        group: "安静时段"
      },
      {
        key: "quietHoursEnd",
        label: "结束时间",
        type: "text",
        defaultValue: "07:00",
        description: "安静时段结束时间（HH:MM 格式）",
        group: "安静时段"
      },
      {
        key: "quietHoursAllowUrgent",
        label: "允许紧急任务穿透",
        type: "toggle",
        defaultValue: true,
        description: "紧急任务是否可以在安静时段内执行",
        group: "安静时段"
      },
      {
        key: "skipRecentEnabled",
        label: "跳过近期活跃会话",
        type: "toggle",
        defaultValue: true,
        description: "如果目标会话近期有活动则跳过本次投递",
        group: "跳过近期活跃"
      },
      {
        key: "skipRecentMinutes",
        label: "活跃窗口（分钟）",
        type: "number",
        defaultValue: 5,
        description: "多少分钟内有活动视为近期活跃",
        group: "跳过近期活跃"
      },
      {
        key: "jobsSummary",
        label: "当前任务",
        type: "readonly",
        description: "已注册的定时任务概览",
        group: "当前任务"
      }
    ],
    onLoad: async () => {
      const cfg = schedulerInstance?.getConfig() ?? DEFAULT_SCHEDULER_CONFIG;
      const jobs = schedulerInstance?.listJobs() ?? [];
      const jobsSummary = jobs.length === 0 ? "暂无任务" : jobs.map((j) => `${j.enabled ? "✓" : "✗"} ${j.name} (${j.schedule.type})`).join(`
`);
      return {
        enabled: cfg.enabled,
        quietHoursEnabled: cfg.quietHours.enabled,
        quietHoursStart: cfg.quietHours.windows[0]?.start ?? "23:00",
        quietHoursEnd: cfg.quietHours.windows[0]?.end ?? "07:00",
        quietHoursAllowUrgent: cfg.quietHours.allowUrgent,
        skipRecentEnabled: cfg.skipIfRecentActivity.enabled,
        skipRecentMinutes: cfg.skipIfRecentActivity.withinMinutes,
        jobsSummary
      };
    },
    onSave: async (values) => {
      try {
        const newConfig = {
          enabled: values.enabled,
          quietHours: {
            enabled: values.quietHoursEnabled,
            windows: [
              {
                start: values.quietHoursStart,
                end: values.quietHoursEnd
              }
            ],
            allowUrgent: values.quietHoursAllowUrgent
          },
          skipIfRecentActivity: {
            enabled: values.skipRecentEnabled,
            withinMinutes: values.skipRecentMinutes
          }
        };
        schedulerInstance?.updateConfig(newConfig);
        const extRootDir = ctx.getExtensionRootDir();
        if (extRootDir) {
          const configPath = path2.join(extRootDir, "config.yaml");
          const yaml = buildConfigYaml(newConfig);
          fs2.writeFileSync(configPath, yaml, "utf-8");
          logger3.info("配置已写回 config.yaml");
        }
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger3.error(`保存配置失败: ${msg}`);
        return { success: false, error: msg };
      }
    }
  });
  logger3.info("Console Settings Tab 已注册");
}
function resolveConfig(pluginConfig) {
  return {
    enabled: pluginConfig?.enabled ?? DEFAULT_SCHEDULER_CONFIG.enabled,
    quietHours: {
      ...DEFAULT_SCHEDULER_CONFIG.quietHours,
      ...pluginConfig?.quietHours
    },
    skipIfRecentActivity: {
      ...DEFAULT_SCHEDULER_CONFIG.skipIfRecentActivity,
      ...pluginConfig?.skipIfRecentActivity
    }
  };
}
function buildConfigYaml(config) {
  const lines = [];
  lines.push("# 定时任务调度插件配置");
  lines.push("#");
  lines.push("# 启用后，LLM 可通过 manage_scheduled_tasks 工具");
  lines.push("# 创建、管理定时任务，实现自动化调度。");
  lines.push("");
  lines.push("# 是否启用调度器");
  lines.push(`enabled: ${config.enabled}`);
  lines.push("");
  lines.push("# 安静时段配置");
  lines.push("# 在安静时段内，非紧急任务将被跳过");
  lines.push("quietHours:");
  lines.push(`  enabled: ${config.quietHours.enabled}`);
  lines.push("  windows:");
  for (const w of config.quietHours.windows) {
    lines.push(`    - start: "${w.start}"`);
    lines.push(`      end: "${w.end}"`);
  }
  lines.push("  # 是否允许紧急任务穿透安静时段");
  lines.push(`  allowUrgent: ${config.quietHours.allowUrgent}`);
  lines.push("");
  lines.push("# 跳过近期活跃会话");
  lines.push("# 如果目标会话在指定分钟内有过活动，则跳过本次投递");
  lines.push("skipIfRecentActivity:");
  lines.push(`  enabled: ${config.skipIfRecentActivity.enabled}`);
  lines.push(`  withinMinutes: ${config.skipIfRecentActivity.withinMinutes}`);
  return lines.join(`
`) + `
`;
}
export {
  src_default as default
};
