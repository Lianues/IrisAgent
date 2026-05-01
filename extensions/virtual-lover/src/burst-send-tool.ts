import {
  DELIVERY_REGISTRY_SERVICE_ID,
  type DeliveryRegistryService,
  type IrisAPI,
  type PluginContext,
  type ToolDefinition,
  type ToolExecutionContext,
} from 'irises-extension-sdk';
import { parseVirtualLoverConfig } from './config.js';

export const VIRTUAL_LOVER_BURST_SEND_TOOL_NAME = 'virtual_lover_burst_send';

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeMessages(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.messages)) {
    return args.messages
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
      .slice(0, 10);
  }

  const text = readString(args.text).trim();
  if (!text) return [];

  return text
    .split(/\n+|\s*\|\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('burst_send 已中止'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('burst_send 已中止'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createVirtualLoverBurstSendTool(ctx: PluginContext, api: IrisAPI): ToolDefinition {
  return {
    declaration: {
      name: VIRTUAL_LOVER_BURST_SEND_TOOL_NAME,
      description: [
        'Send multiple short virtual-lover messages in sequence via the generic delivery registry.',
        'Use this for natural burst-style companion messages. The tool does not call platform clients directly.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short messages to send in order. Maximum 10 messages.',
          },
          text: { type: 'string', description: 'Alternative input: split by newlines or || into multiple messages.' },
          intervalMs: { type: 'number', description: 'Delay between messages in milliseconds. Default 1200, max 60000.' },
          dryRun: { type: 'boolean', description: 'If true, preview messages without sending.' },
          urgent: { type: 'boolean', description: 'Whether the first message may bypass policy quiet hours if policy allows urgent.' },
        },
      },
    },
    parallel: false,
    handler: async (args, context?: ToolExecutionContext) => {
      const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
      if (!config.enabled) return { ok: false, error: 'virtual-lover.enabled 为 false' };
      if (!config.proactive.enabled) return { ok: false, error: 'proactive.enabled 为 false' };

      const messages = normalizeMessages(args);
      if (messages.length === 0) {
        return { ok: false, error: 'messages/text 不能为空。请提供要连续发送的短消息。' };
      }

      const intervalMs = clamp(Math.trunc(readNumber(args.intervalMs, 1200)), 0, 60_000);
      if (args.dryRun === true) {
        return { ok: true, dryRun: true, messages, intervalMs };
      }

      if (!config.proactive.binding && !config.proactive.target.id.trim()) {
        return { ok: false, error: '未配置发送目标。请在 /lover 中填写发送目标名称和目标 ID。' };
      }

      const delivery = api.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery) return { ok: false, error: 'delivery.registry service 不可用' };

      const results = [];
      for (let index = 0; index < messages.length; index++) {
        if (context?.signal?.aborted) throw new Error('burst_send 已中止');
        const metadata = {
          source: 'virtual-lover.burst_send',
          index: index + 1,
          total: messages.length,
        };
        const policyId = index === 0 ? config.proactive.policy : undefined;
        const result = config.proactive.binding
          ? await delivery.sendTextToBinding({
            binding: config.proactive.binding,
            text: messages[index],
            metadata,
            policyId,
            urgent: args.urgent === true,
          })
          : await delivery.sendText({
            platform: config.proactive.platform,
            target: config.proactive.target,
            text: messages[index],
            metadata,
            policyId,
            urgent: args.urgent === true,
          });
        results.push({ message: messages[index], result });
        if (!result.ok) {
          return { ok: false, sentCount: index, failedAt: index + 1, error: result.error, results };
        }
        if (index < messages.length - 1) await wait(intervalMs, context?.signal);
      }

      return { ok: true, sentCount: messages.length, intervalMs, results };
    },
  };
}
