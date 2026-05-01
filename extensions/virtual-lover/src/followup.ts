import {
  SCHEDULER_SERVICE_ID,
  type GlobalStoreLike,
  type IrisAPI,
  type PluginContext,
  type SchedulerService,
  type ToolDefinition,
} from 'irises-extension-sdk';
import { parseVirtualLoverConfig, type VirtualLoverConfig } from './config.js';
import { VIRTUAL_LOVER_PROACTIVE_TOOL_NAME } from './proactive-tool.js';

export const VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME = 'virtual_lover_schedule_followup';

type FollowupMode = 'followup' | 'deferred_reply';

type FollowupIntentStatus = 'scheduled' | 'skipped';

interface FollowupIntent {
  id: string;
  mode: FollowupMode;
  status: FollowupIntentStatus;
  sessionId: string;
  reason: string;
  text?: string;
  dedupeKey?: string;
  createdAt: number;
  scheduledAt: number;
  jobId?: string;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown): number | undefined {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizeMode(value: unknown): FollowupMode {
  return value === 'deferred_reply' ? 'deferred_reply' : 'followup';
}

function parseTimeToAt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const ms = unit.startsWith('s') ? amount * 1_000
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

function resolveScheduledAt(args: Record<string, unknown>, config: VirtualLoverConfig, mode: FollowupMode): number {
  const at = readString(args.at).trim();
  if (at) {
    const parsed = parseTimeToAt(at);
    if (parsed && parsed > Date.now()) return parsed;
  }

  const delay = readString(args.delay).trim();
  if (delay) {
    const parsed = parseTimeToAt(delay);
    if (parsed && parsed > Date.now()) return parsed;
  }

  const delayMinutes = readNumber(args.delayMinutes);
  if (delayMinutes && delayMinutes > 0) return Date.now() + Math.round(delayMinutes * 60_000);

  const fallbackMinutes = mode === 'deferred_reply'
    ? config.proactive.deferredReply.defaultDelayMinutes
    : config.proactive.followup.defaultDelayMinutes;
  return Date.now() + fallbackMinutes * 60_000;
}

function buildInstruction(input: { mode: FollowupMode; reason: string; text?: string }): string {
  const args: Record<string, unknown> = { dryRun: false };
  if (input.text?.trim()) args.text = input.text.trim();
  args.reason = input.reason.trim();

  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    input.mode === 'deferred_reply'
      ? '这是一次延迟回复/稍后接话任务。'
      : '这是一次后续关心 follow-up 任务。',
    '必须调用工具，不要只用文字回复。',
    '工具参数如下：',
    JSON.stringify(args, null, 2),
  ].join('\n');
}

function getStore(api: IrisAPI): GlobalStoreLike {
  return api.globalStore.namespace('virtual-lover').namespace('followups');
}

function listIntents(store: GlobalStoreLike): FollowupIntent[] {
  return Object.values(store.getAll()).filter((value): value is FollowupIntent => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      && typeof (value as FollowupIntent).id === 'string'
      && typeof (value as FollowupIntent).scheduledAt === 'number';
  });
}

function makeIntentId(mode: FollowupMode): string {
  return `${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findDuplicateIntent(store: GlobalStoreLike, dedupeKey: string, dedupeHours: number): FollowupIntent | undefined {
  const threshold = Date.now() - dedupeHours * 3_600_000;
  return listIntents(store).find((intent) =>
    intent.status === 'scheduled'
    && intent.dedupeKey === dedupeKey
    && intent.createdAt >= threshold,
  );
}

function resolveSessionId(api: IrisAPI, args: Record<string, unknown>): string {
  return readString(args.sessionId).trim()
    || api.agentManager?.getActiveSessionId?.()
    || 'virtual-lover-followup';
}

export async function scheduleVirtualLoverFollowup(
  ctx: PluginContext,
  api: IrisAPI,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; intent?: FollowupIntent; error?: string; skipped?: boolean }> {
  const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
  const mode = normalizeMode(args.mode);
  if (!config.enabled) return { ok: false, error: 'virtual-lover.enabled 为 false' };
  if (!config.proactive.enabled) return { ok: false, error: 'proactive.enabled 为 false' };
  if (mode === 'followup' && !config.proactive.followup.enabled) {
    return { ok: false, error: 'proactive.followup.enabled 为 false' };
  }
  if (mode === 'deferred_reply' && !config.proactive.deferredReply.enabled) {
    return { ok: false, error: 'proactive.deferredReply.enabled 为 false' };
  }

  const scheduler = api.services.get<SchedulerService>(SCHEDULER_SERVICE_ID);
  if (!scheduler) return { ok: false, error: `${SCHEDULER_SERVICE_ID} service 不可用，请启用 cron extension。` };

  const reason = readString(args.reason).trim();
  if (!reason) return { ok: false, error: 'reason 不能为空' };

  const sessionId = resolveSessionId(api, args);
  const text = readString(args.text).trim() || undefined;
  const dedupeKey = readString(args.dedupeKey).trim() || undefined;
  const store = getStore(api);

  if (dedupeKey) {
    const duplicate = findDuplicateIntent(store, dedupeKey, config.proactive.followup.dedupeHours);
    if (duplicate) return { ok: true, skipped: true, intent: duplicate };
  }

  const scheduledAt = resolveScheduledAt(args, config, mode);
  const intent: FollowupIntent = {
    id: makeIntentId(mode),
    mode,
    status: 'scheduled',
    sessionId,
    reason,
    text,
    dedupeKey,
    createdAt: Date.now(),
    scheduledAt,
  };

  if (args.dryRun === true) return { ok: true, intent };

  const job = await scheduler.createJob({
    name: `[virtual-lover:${mode}:${intent.id}] ${mode === 'deferred_reply' ? '延迟回复' : '后续关心'}`,
    schedule: { type: 'once', at: scheduledAt },
    instruction: buildInstruction({ mode, reason, text }),
    sessionId,
    delivery: { sessionId, fallback: 'last-active' },
    silent: true,
    urgent: args.urgent === true,
    allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
    createdInSession: sessionId,
  });
  intent.jobId = job.id;
  store.set(intent.id, intent);
  return { ok: true, intent };
}

export function createVirtualLoverFollowupTool(ctx: PluginContext, api: IrisAPI): ToolDefinition {
  return {
    declaration: {
      name: VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME,
      description: [
        'Schedule a virtual-lover follow-up or deferred reply using the generic scheduler.tasks service.',
        'Use followup for future-event check-ins, and deferred_reply for delayed continuation.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['followup', 'deferred_reply'], description: 'Task mode. Default followup.' },
          reason: { type: 'string', description: 'Why this future proactive message should be sent.' },
          text: { type: 'string', description: 'Optional exact message to send. If omitted, text is generated at runtime.' },
          delay: { type: 'string', description: 'Relative delay, e.g. 30m, 2h, 1d.' },
          delayMinutes: { type: 'number', description: 'Relative delay in minutes.' },
          at: { type: 'string', description: 'Absolute time, e.g. 2026-04-30 20:00.' },
          sessionId: { type: 'string', description: 'Optional source/target session id.' },
          dedupeKey: { type: 'string', description: 'Optional stable key to avoid duplicate follow-ups.' },
          urgent: { type: 'boolean', description: 'Whether the scheduled job is urgent.' },
          dryRun: { type: 'boolean', description: 'Preview intent without creating scheduler job.' },
        },
        required: ['reason'],
      },
    },
    parallel: false,
    handler: async (args) => {
      const result = await scheduleVirtualLoverFollowup(ctx, api, args);
      return {
        ok: result.ok,
        skipped: result.skipped,
        intent: result.intent,
        error: result.error,
      };
    },
  };
}
