import {
  SCHEDULER_SERVICE_ID,
  type IrisAPI,
  type SchedulerScheduleConfig,
  type SchedulerService,
  type ToolDefinition,
} from 'irises-extension-sdk';
import { VIRTUAL_LOVER_PROACTIVE_TOOL_NAME } from './proactive-tool.js';

export const VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME = 'virtual_lover_schedule_proactive';

type ProactiveScheduleTemplate = 'test_30s' | 'good_morning_daily' | 'goodnight_daily' | 'daily_check_in' | 'custom';

type ScheduleType = 'cron' | 'interval' | 'once';

interface TemplateDef {
  name: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  reason: string;
}

const TEMPLATES: Record<Exclude<ProactiveScheduleTemplate, 'custom'>, TemplateDef> = {
  test_30s: {
    name: 'Virtual Lover 测试主动消息',
    scheduleType: 'once',
    scheduleValue: '30s',
    reason: '测试 30 秒后的主动消息发送链路。',
  },
  good_morning_daily: {
    name: 'Virtual Lover 每日早安',
    scheduleType: 'cron',
    scheduleValue: '0 8 * * *',
    reason: '每日早晨发送一条自然、轻柔、不打扰的早安问候。',
  },
  goodnight_daily: {
    name: 'Virtual Lover 每日晚安',
    scheduleType: 'cron',
    scheduleValue: '0 23 * * *',
    reason: '睡前发送一条简短、安静、温柔的晚安消息。',
  },
  daily_check_in: {
    name: 'Virtual Lover 每日关心',
    scheduleType: 'cron',
    scheduleValue: '0 20 * * *',
    reason: '每天晚上发送一条不过度打扰的关心和陪伴消息。',
  },
};

function normalizeTemplate(value: unknown): ProactiveScheduleTemplate {
  return value === 'test_30s'
    || value === 'good_morning_daily'
    || value === 'goodnight_daily'
    || value === 'daily_check_in'
    || value === 'custom'
    ? value
    : 'test_30s';
}

function normalizeScheduleType(value: unknown, fallback: ScheduleType): ScheduleType {
  return value === 'cron' || value === 'interval' || value === 'once' ? value : fallback;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseOnceScheduleValue(value: string): number | undefined {
  const trimmed = value.trim();
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const ms = unit.startsWith('s') ? amount * 1000
      : unit.startsWith('m') ? amount * 60_000
      : unit.startsWith('h') ? amount * 3_600_000
      : amount * 86_400_000;
    return Date.now() + Math.round(ms);
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_577_836_800_000 ? numeric : Date.now() + Math.round(numeric);
  }
  const parsed = Date.parse(trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildScheduleConfig(scheduleType: ScheduleType, scheduleValue: string): SchedulerScheduleConfig | { error: string } {
  if (scheduleType === 'cron') return { type: 'cron', expression: scheduleValue };
  if (scheduleType === 'interval') {
    const ms = Number(scheduleValue);
    return Number.isFinite(ms) && ms > 0
      ? { type: 'interval', ms: Math.trunc(ms) }
      : { error: `无效 interval schedule_value: ${scheduleValue}` };
  }
  const at = parseOnceScheduleValue(scheduleValue);
  return at && at > Date.now()
    ? { type: 'once', at }
    : { error: `无效 once schedule_value: ${scheduleValue}` };
}

function buildInstruction(input: { text?: string; reason: string }): string {
  const args: Record<string, unknown> = { dryRun: false };
  if (input.text?.trim()) args.text = input.text.trim();
  if (input.reason.trim()) args.reason = input.reason.trim();

  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    '必须调用工具，不要只用文字回复。',
    '工具参数如下：',
    JSON.stringify(args, null, 2),
  ].join('\n');
}

export function createVirtualLoverScheduleProactiveTool(api: IrisAPI): ToolDefinition {
  return {
    declaration: {
      name: VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME,
      description: [
        'Create a cron scheduled task that triggers virtual_lover_proactive_send.',
        'This is a template helper for proactive companion messages such as good morning, goodnight, check-in, or a 30-second test.',
        'It uses the cron extension manage_scheduled_tasks tool and does not implement its own scheduler.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            enum: ['test_30s', 'good_morning_daily', 'goodnight_daily', 'daily_check_in', 'custom'],
            description: 'Schedule template. Use custom with schedule_type and schedule_value for arbitrary schedules.',
          },
          name: { type: 'string', description: 'Optional scheduled job name override.' },
          schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], description: 'Optional schedule type override.' },
          schedule_value: { type: 'string', description: 'Optional schedule value override, e.g. "30s", "0 23 * * *", or "86400000".' },
          reason: { type: 'string', description: 'Optional reason/context passed to virtual_lover_proactive_send.' },
          text: { type: 'string', description: 'Optional exact message text for scheduled sends. If omitted, it will be generated at runtime.' },
          silent: { type: 'boolean', description: 'Cron silent flag. Default true to avoid LLM follow-up turns.' },
          urgent: { type: 'boolean', description: 'Whether this cron job is urgent and may bypass quiet hours.' },
          dryRun: { type: 'boolean', description: 'If true, return the cron creation payload without creating the job.' },
        },
      },
    },
    parallel: false,
    handler: async (args) => {
      const template = normalizeTemplate(args.template);
      const base = template === 'custom'
        ? { name: 'Virtual Lover 自定义主动消息', scheduleType: 'once' as ScheduleType, scheduleValue: '30s', reason: '自定义主动消息。' }
        : TEMPLATES[template];

      const scheduleType = normalizeScheduleType(args.schedule_type, base.scheduleType);
      const scheduleValue = readString(args.schedule_value, base.scheduleValue).trim() || base.scheduleValue;
      const reason = readString(args.reason, base.reason).trim() || base.reason;
      const name = readString(args.name, base.name).trim() || base.name;
      const text = readString(args.text).trim();
      const silent = typeof args.silent === 'boolean' ? args.silent : true;
      const urgent = args.urgent === true;

      const payload = {
        action: 'create',
        name,
        schedule_type: scheduleType,
        schedule_value: scheduleValue,
        instruction: buildInstruction({ text, reason }),
        silent,
        urgent,
        allowed_tools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
      };

      if (args.dryRun === true) {
        return { ok: true, dryRun: true, template, payload };
      }

      const scheduler = api.services.get<SchedulerService>(SCHEDULER_SERVICE_ID);
      if (scheduler) {
        const schedule = buildScheduleConfig(scheduleType, scheduleValue);
        if ('error' in schedule) return { ok: false, error: schedule.error, template, payload };
        const job = await scheduler.createJob({
          name,
          schedule,
          instruction: buildInstruction({ text, reason }),
          silent,
          urgent,
          allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
        });
        return { ok: true, template, payload, job, via: SCHEDULER_SERVICE_ID };
      }

      if (typeof api.tools.execute !== 'function') {
        return { ok: false, error: 'scheduler.tasks service 与 ToolRegistry.execute 均不可用，无法创建调度任务。', payload };
      }

      try {
        const result = await api.tools.execute('manage_scheduled_tasks', payload);
        return { ok: !(result as any)?.error, template, payload, result, via: 'manage_scheduled_tasks' };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          hint: '请确认 cron extension 已启用，并且 manage_scheduled_tasks 工具可用。',
          payload,
        };
      }
    },
  };
}
