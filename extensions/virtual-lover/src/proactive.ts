import {
  DELIVERY_REGISTRY_SERVICE_ID,
  ENVIRONMENT_CONTEXT_SERVICE_ID,
  WEATHER_SERVICE_ID,
  extractText,
  type DeliveryRegistryService,
  type EnvironmentContextService,
  type DeliveryResult,
  type IrisAPI,
  type LLMRequest,
  type WeatherService,
} from 'irises-extension-sdk';
import type { VirtualLoverConfig } from './config.js';
import { buildVirtualLoverPrompt } from './prompt/builder.js';
import type { PromptBundleSnapshot } from './state.js';
import type { MemorySpacesServiceLike } from './memory-tools.js';

export interface ProactiveSendInput {
  config: VirtualLoverConfig;
  api: IrisAPI;
  bundle: PromptBundleSnapshot;
  agentId: string;
  text?: string;
  reason?: string;
  dryRun?: boolean;
  now?: Date;
}

export interface ProactiveSendResult {
  ok: boolean;
  sent: boolean;
  dryRun: boolean;
  text: string;
  delivery?: DeliveryResult;
  error?: string;
}

export async function sendProactiveMessage(input: ProactiveSendInput): Promise<ProactiveSendResult> {
  const { config, api } = input;
  if (!config.enabled) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: '', error: 'virtual-lover.enabled 为 false' };
  }
  if (!config.proactive.enabled) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: '', error: 'proactive.enabled 为 false' };
  }

  const text = (input.text?.trim() || await generateProactiveText(input)).trim();
  if (!text) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: '', error: '主动消息内容为空' };
  }

  if (input.dryRun) {
    return { ok: true, sent: false, dryRun: true, text };
  }

  if (!config.proactive.binding && !config.proactive.target.id.trim()) {
    return { ok: false, sent: false, dryRun: false, text, error: 'proactive.target.id 未配置' };
  }

  const delivery = api.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
  if (!delivery) {
    return { ok: false, sent: false, dryRun: false, text, error: 'delivery.registry service 不可用' };
  }

  const metadata = {
    source: 'virtual-lover.proactive',
    agentId: input.agentId,
  };

  const result = config.proactive.binding
    ? await delivery.sendTextToBinding({
      binding: config.proactive.binding,
      text,
      metadata,
      policyId: config.proactive.policy,
    })
    : await delivery.sendText({
      platform: config.proactive.platform,
      target: config.proactive.target,
      text,
      metadata,
      policyId: config.proactive.policy,
    });

  return {
    ok: result.ok,
    sent: result.ok,
    dryRun: false,
    text,
    delivery: result,
    error: result.ok ? undefined : result.error,
  };
}

export async function generateProactiveText(input: ProactiveSendInput): Promise<string> {
  const { config, api, bundle, agentId } = input;
  if (!config.proactive.generation.enabled) return '';
  if (!api.router.chat) {
    throw new Error('当前 LLM router 不支持非流式 chat 调用');
  }

  const loverMemoryContext = await buildProactiveMemoryContext(config, api, input.reason)
    .catch(() => {
      // 主动消息生成不应因 lover memory space 暂不可用而失败。
      // 记忆只作为增强上下文，基础 persona/style/rules 仍可生成可发送文本。
      return undefined;
    });
  const environmentContext = await buildProactiveEnvironmentContext(api, input.reason)
    .catch(() => undefined);
  const prompt = buildVirtualLoverPrompt({
    agentId,
    now: input.now ?? new Date(),
    config,
    bundle,
    loverMemoryContext,
  });

  const request: LLMRequest = {
    contents: [{
      role: 'user',
      parts: [{ text: buildGenerationInstruction(config, input.reason, environmentContext) }],
    }],
    systemInstruction: {
      parts: [{ text: prompt.systemText }],
    },
    generationConfig: {
      maxOutputTokens: config.proactive.generation.maxOutputTokens,
      temperature: config.proactive.generation.temperature,
    },
  };

  const response = await api.router.chat(request);
  return extractText(response.content.parts).trim();
}

async function buildProactiveMemoryContext(
  config: VirtualLoverConfig,
  api: IrisAPI,
  reason?: string,
): Promise<string | undefined> {
  if (!config.memory.autoInject) return undefined;
  const service = api.services.get<MemorySpacesServiceLike>('memory.spaces');
  if (!service) return undefined;
  const query = reason?.trim() || 'relationship context, user preferences, recent emotional continuity';
  const space = service.getOrCreateSpace(config.memory.space);
  const result = await space.buildContext?.({
    userText: query,
    maxBytes: config.memory.maxRecallBytes,
  });
  return result?.text;
}

async function buildProactiveEnvironmentContext(api: IrisAPI, reason?: string): Promise<string | undefined> {
  const contextService = api.services.get<EnvironmentContextService>(ENVIRONMENT_CONTEXT_SERVICE_ID);
  if (contextService?.buildContext) {
    const result = await contextService.buildContext({
      kind: 'weather',
      query: reason?.trim() || 'weather, time, location and environmental context for a gentle proactive companion message',
      maxBytes: 4000,
    });
    if (result?.text?.trim()) return result.text.trim();
  }

  const weatherService = api.services.get<WeatherService>(WEATHER_SERVICE_ID);
  const weather = await weatherService?.getWeather?.({});
  return weather?.text?.trim() || undefined;
}

function buildGenerationInstruction(config: VirtualLoverConfig, reason?: string, environmentContext?: string): string {
  const parts = [config.proactive.generation.instruction.trim()];
  const normalizedReason = reason?.trim();
  if (normalizedReason) {
    parts.push(`\n触发原因 / 参考上下文：\n${normalizedReason}`);
  }
  const normalizedEnvironment = environmentContext?.trim();
  if (normalizedEnvironment) {
    parts.push(`\n环境 / 天气上下文（来自 Iris 通用 environment service）：\n${normalizedEnvironment}`);
  }
  parts.push('\n约束：\n- 只输出最终要发送的一条消息。\n- 不要输出分析过程。\n- 不要使用 markdown 标题。\n- 不要假装已经做出现实世界行动。');
  return parts.join('\n');
}
