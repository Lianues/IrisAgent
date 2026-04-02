/**
 * manage_scheduled_tasks 工具定义
 *
 * 为 LLM 提供定时任务的 CRUD 操作接口。
 * scheduler 实例和当前 sessionId 通过外部注入。
 */

import { createPluginLogger } from '@irises/extension-sdk';
import type { ToolDefinition } from '@irises/extension-sdk';
import type { CronScheduler } from './scheduler.js';
import type { ScheduleConfig, CreateJobParams, UpdateJobParams } from './types.js';

const logger = createPluginLogger('cron', 'tool');

// ============ 模块级状态（由插件入口注入） ============

/** 调度器实例引用，由 injectScheduler 设置 */
let scheduler: CronScheduler | null = null;

/** 当前 turn 所属的 sessionId，由 setCurrentSessionId 在每次 chat 前设置 */
let currentSessionId: string = 'default';

/**
 * 注入调度器实例
 * 由插件入口在 onReady 中调用。
 * @param s CronScheduler 实例
 */
export function injectScheduler(s: CronScheduler): void {
  scheduler = s;
}

/**
 * 设置当前 turn 的 sessionId
 * 由插件入口通过 onBeforeChat 钩子在每次 chat 前调用。
 * @param sid 会话 ID
 */
export function setCurrentSessionId(sid: string): void {
  currentSessionId = sid;
}

// ============ 工具定义 ============

/**
 * manage_scheduled_tasks 工具
 *
 * 支持的操作：create / update / delete / enable / disable / list / get
 * 支持三种调度模式：cron 表达式 / 固定间隔（毫秒） / 一次性（Unix 时间戳）
 */
export const manageScheduledTasksTool: ToolDefinition = {
  declaration: {
    name: 'manage_scheduled_tasks',
    description:
      '管理定时调度任务。支持创建（create）、更新（update）、删除（delete）、启用（enable）、禁用（disable）、列出（list）和查询（get）定时任务。\n' +
      '调度模式：cron（cron 表达式，如 "0 9 * * 1-5" 表示工作日每天早上9点）、interval（固定间隔毫秒数）、once（一次性 Unix 时间戳）。\n' +
      '任务触发后会在后台独立拉起一个 agent 执行预设的 instruction 指令（拥有独立的工具调用能力），' +
      '执行完成后将结果报告推送到所有已启动的前端平台，不占用当前对话。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'enable', 'disable', 'list', 'get'],
          description: '操作类型',
        },
        name: {
          type: 'string',
          description: '任务名称（create / update 时使用）',
        },
        schedule_type: {
          type: 'string',
          enum: ['cron', 'interval', 'once'],
          description: '调度类型（create / update 时使用）',
        },
        schedule_value: {
          type: 'string',
          description:
            '调度参数值：cron 表达式（如 "0 9 * * 1-5"）/ 间隔毫秒数（如 "60000"）/ Unix 时间戳（如 "1700000000000"）',
        },
        instruction: {
          type: 'string',
          description: '任务触发时发送给 LLM 的指令文本',
        },
        silent: {
          type: 'boolean',
          description: '静默模式：如果没有值得报告的内容则不发送消息',
        },
        urgent: {
          type: 'boolean',
          description: '紧急任务：可穿透安静时段限制',
        },
        job_id: {
          type: 'string',
          description: '任务 ID（update / delete / enable / disable / get 时使用）',
        },
      },
      required: ['action'],
    },
  },

  // 任务管理操作不可并行执行
  parallel: false,

  handler: async (args: Record<string, unknown>) => {
    // 检查调度器是否已注入
    if (!scheduler) {
      return { error: '调度器尚未初始化，请稍后重试' };
    }

    const action = args.action as string;

    switch (action) {
      // ────── 创建任务 ──────
      case 'create': {
        const name = args.name as string | undefined;
        const scheduleType = args.schedule_type as string | undefined;
        const scheduleValue = args.schedule_value as string | undefined;
        const instruction = args.instruction as string | undefined;

        // 校验必填参数
        if (!name || !scheduleType || !scheduleValue || !instruction) {
          return {
            error:
              'create 操作需要以下参数：name, schedule_type, schedule_value, instruction',
          };
        }

        // 根据调度类型构建 ScheduleConfig
        let schedule: ScheduleConfig;
        switch (scheduleType) {
          case 'cron':
            schedule = { type: 'cron', expression: scheduleValue };
            break;
          case 'interval': {
            const ms = parseInt(scheduleValue, 10);
            if (isNaN(ms) || ms <= 0) {
              return { error: `无效的间隔值: "${scheduleValue}"，应为正整数毫秒数` };
            }
            schedule = { type: 'interval', ms };
            break;
          }
          case 'once': {
            const at = parseInt(scheduleValue, 10);
            if (isNaN(at) || at <= 0) {
              return { error: `无效的时间戳: "${scheduleValue}"，应为正整数 Unix 时间戳` };
            }
            schedule = { type: 'once', at };
            break;
          }
          default:
            return { error: `不支持的调度类型: "${scheduleType}"` };
        }

        // 自动填充 sessionId / delivery / createdInSession
        const params: CreateJobParams = {
          name,
          schedule,
          sessionId: currentSessionId,
          instruction,
          delivery: {
            sessionId: currentSessionId,
            fallback: 'last-active',
          },
          silent: (args.silent as boolean) ?? false,
          urgent: (args.urgent as boolean) ?? false,
          createdInSession: currentSessionId,
        };

        const job = scheduler.createJob(params);
        logger.info(`工具调用: 创建任务 "${job.name}" (${job.id})`);

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
            createdAt: new Date(job.createdAt).toISOString(),
          },
        };
      }

      // ────── 更新任务 ──────
      case 'update': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'update 操作需要 job_id 参数' };
        }

        // 收集所有可更新的字段
        const updateParams: UpdateJobParams = {};
        if (args.name !== undefined) updateParams.name = args.name as string;
        if (args.instruction !== undefined)
          updateParams.instruction = args.instruction as string;
        if (args.silent !== undefined) updateParams.silent = args.silent as boolean;
        if (args.urgent !== undefined) updateParams.urgent = args.urgent as boolean;

        // 如果同时提供了调度类型和值，则更新调度配置
        if (args.schedule_type && args.schedule_value) {
          const st = args.schedule_type as string;
          const sv = args.schedule_value as string;
          switch (st) {
            case 'cron':
              updateParams.schedule = { type: 'cron', expression: sv };
              break;
            case 'interval':
              updateParams.schedule = { type: 'interval', ms: parseInt(sv, 10) };
              break;
            case 'once':
              updateParams.schedule = { type: 'once', at: parseInt(sv, 10) };
              break;
          }
        }

        const updated = scheduler.updateJob(jobId, updateParams);
        if (!updated) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 更新任务 "${updated.name}" (${jobId})`);
        return { success: true, job: updated };
      }

      // ────── 删除任务 ──────
      case 'delete': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'delete 操作需要 job_id 参数' };
        }

        const deleted = scheduler.deleteJob(jobId);
        if (!deleted) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 删除任务 ${jobId}`);
        return { success: true, message: `任务 ${jobId} 已删除` };
      }

      // ────── 启用任务 ──────
      case 'enable': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'enable 操作需要 job_id 参数' };
        }

        const enabled = scheduler.enableJob(jobId);
        if (!enabled) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 启用任务 "${enabled.name}" (${jobId})`);
        return { success: true, job: enabled };
      }

      // ────── 禁用任务 ──────
      case 'disable': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'disable 操作需要 job_id 参数' };
        }

        const disabled = scheduler.disableJob(jobId);
        if (!disabled) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 禁用任务 "${disabled.name}" (${jobId})`);
        return { success: true, job: disabled };
      }

      // ────── 列出所有任务 ──────
      case 'list': {
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
            lastRunAt: j.lastRunAt
              ? new Date(j.lastRunAt).toISOString()
              : null,
            lastRunStatus: j.lastRunStatus ?? null,
          })),
        };
      }

      // ────── 查询单个任务 ──────
      case 'get': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'get 操作需要 job_id 参数' };
        }

        const job = scheduler.getJob(jobId);
        if (!job) {
          return { error: `未找到任务: ${jobId}` };
        }

        return { success: true, job };
      }

      // ────── 未知操作 ──────
      default:
        return { error: `不支持的操作类型: "${action}"` };
    }
  },
};
