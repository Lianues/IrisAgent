import type { DeliveryTarget, DeliveryTargetKind } from 'irises-extension-sdk';

export type VirtualLoverAgentMode = 'single' | 'multi';
export type VirtualLoverInjectionMode = 'prepend' | 'replace';

export interface VirtualLoverAgentConfig {
  mode: VirtualLoverAgentMode;
  defaultAgentId: string;
}

export interface VirtualLoverPromptConfig {
  enabled: boolean;
  injectionMode: VirtualLoverInjectionMode;
  priority: number;
  onlyFirstRound: boolean;
  useAntml: boolean;
  sections: string[];
}

export interface VirtualLoverMemoryConfig {
  /** Iris memory extension 中的命名 space，不是 virtual-lover 私有存储 */
  space: string;
  /** 是否在 virtual-lover prompt 中注入该 space 的 recall 结果 */
  autoInject: boolean;
  /** 单次 lover recall 最大字节数 */
  maxRecallBytes: number;
  /** 对话结束后自动提取 lover 专属记忆到 memory space */
  autoExtract: boolean;
  /** 每 N 轮对话后提取一次 lover 记忆 */
  extractInterval: number;
  tools: {
    /** 是否注册 lover_memory_* 工具 */
    enabled: boolean;
  };
}

export interface VirtualLoverFollowupConfig {
  enabled: boolean;
  defaultDelayMinutes: number;
  dedupeHours: number;
}

export interface VirtualLoverDeferredReplyConfig {
  enabled: boolean;
  defaultDelayMinutes: number;
}

export interface VirtualLoverScheduledStrategyConfig {
  enabled: boolean;
  /** cron 表达式，由通用 scheduler.tasks/cron extension 执行 */
  schedule: string;
  /** 传给 proactive 生成器的触发原因 */
  reason: string;
  /** 是否穿透 delivery/cron 的部分安静时段策略 */
  urgent: boolean;
}

export interface VirtualLoverRandomStrategyConfig {
  enabled: boolean;
  /** 每日随机窗口开始 HH:MM */
  windowStart: string;
  /** 每日随机窗口结束 HH:MM */
  windowEnd: string;
  /** 每日最少随机任务数 */
  minPerDay: number;
  /** 每日最多随机任务数 */
  maxPerDay: number;
  reason: string;
}

export interface VirtualLoverLateNightStrategyConfig {
  enabled: boolean;
  /** 深夜检查任务 cron 表达式 */
  schedule: string;
  reason: string;
  urgent: boolean;
}

export interface VirtualLoverMemoryStrategyConfig {
  enabled: boolean;
  schedule: string;
  /** 用作 lover memory recall 的查询语义 */
  query: string;
  reason: string;
  urgent: boolean;
}

export interface VirtualLoverWeatherStrategyConfig {
  enabled: boolean;
  schedule: string;
  reason: string;
  urgent: boolean;
}

export interface VirtualLoverProactiveStrategiesConfig {
  /** 固定时段：早安 */
  goodMorning: VirtualLoverScheduledStrategyConfig;
  /** 固定时段：晚安 */
  goodnight: VirtualLoverScheduledStrategyConfig;
  /** 固定时段：每日关心 */
  dailyCheckIn: VirtualLoverScheduledStrategyConfig;
  /** 允许时段内随机主动消息 */
  random: VirtualLoverRandomStrategyConfig;
  /** 深夜轻提醒 */
  lateNight: VirtualLoverLateNightStrategyConfig;
  /** 基于 lover memory 的主动关心 */
  memory: VirtualLoverMemoryStrategyConfig;
  /** 基于通用 weather/environment service 的主动关心 */
  weather: VirtualLoverWeatherStrategyConfig;
}

export interface VirtualLoverProactiveConfig {
  /** 是否允许通过 Web/API 主动生成或发送消息 */
  enabled: boolean;
  /** 通过 delivery.registry 使用的平台 provider */
  platform: string;
  /** 可选 delivery policy id，用于 cooldown/maxPerDay/quietHours 等通用门控 */
  policy?: string;
  /** 通用 delivery binding id。设置后优先使用 binding，platform/target 作为 fallback。 */
  binding?: string;
  /** 投递目标。MVP 直接配置 target，后续可改为 binding 引用。 */
  target: DeliveryTarget;
  strategies: VirtualLoverProactiveStrategiesConfig;
  followup: VirtualLoverFollowupConfig;
  deferredReply: VirtualLoverDeferredReplyConfig;
  generation: {
    enabled: boolean;
    instruction: string;
    maxOutputTokens: number;
    temperature: number;
  };
}

export interface VirtualLoverWebConfig {
  enabled: boolean;
  basePath: string;
  panelPath: string;
}

export interface VirtualLoverConfig {
  enabled: boolean;
  agent: VirtualLoverAgentConfig;
  prompt: VirtualLoverPromptConfig;
  /** 仅引用 Iris memory extension 的 memory space，不实现私有记忆技术栈 */
  memory: VirtualLoverMemoryConfig;
  proactive: VirtualLoverProactiveConfig;
  web: VirtualLoverWebConfig;
}

export const DEFAULT_PROACTIVE_INSTRUCTION = '请基于伴侣人设、说话风格、相处边界、可用记忆和环境上下文，生成一条自然、简短、不过度打扰的主动消息。只输出要发送给用户的消息正文，不要解释。消息应低压力、可忽略，不要求用户立刻回复。';

export const DEFAULT_VIRTUAL_LOVER_CONFIG: VirtualLoverConfig = {
  enabled: false,
  agent: {
    mode: 'single',
    defaultAgentId: 'default',
  },
  prompt: {
    enabled: true,
    injectionMode: 'prepend',
    priority: 300,
    onlyFirstRound: true,
    useAntml: true,
    sections: ['persona', 'style', 'rules', 'lover_memory'],
  },
  memory: {
    space: 'virtual-lover',
    autoInject: true,
    maxRecallBytes: 12000,
    autoExtract: true,
    extractInterval: 1,
    tools: {
      enabled: true,
    },
  },
  proactive: {
    enabled: false,
    platform: 'telegram',
    policy: undefined,
    binding: undefined,
    target: {
      kind: 'chat',
      id: '',
    },
    strategies: {
      goodMorning: {
        enabled: false,
        schedule: '0 8 * * *',
        reason: '早晨轻声问候，给用户一个稳定、温柔、不要求立刻回应的开始。',
        urgent: false,
      },
      goodnight: {
        enabled: false,
        schedule: '0 23 * * *',
        reason: '睡前发送一条简短、安静、温柔的晚安消息，帮助用户放松下来。',
        urgent: false,
      },
      dailyCheckIn: {
        enabled: false,
        schedule: '0 20 * * *',
        reason: '每天固定时间轻轻关心一下用户今天的状态，不追问、不制造压力。',
        urgent: false,
      },
      random: {
        enabled: false,
        windowStart: '10:00',
        windowEnd: '22:00',
        minPerDay: 0,
        maxPerDay: 2,
        reason: '在合适时段发送一条像自然想起用户一样的轻柔问候，短一点，不打扰。',
      },
      lateNight: {
        enabled: false,
        schedule: '0 1 * * *',
        reason: '深夜用克制、温柔的方式提醒用户照顾自己和休息，不责备、不催促。',
        urgent: true,
      },
      memory: {
        enabled: false,
        schedule: '0 21 * * *',
        query: 'relationship milestones, important dates, recent emotional needs, user preferences',
        reason: '参考伴侣专属记忆中的偏好、重要日期或近期情绪线索，发送一条自然、不突兀的关心。',
        urgent: false,
      },
      weather: {
        enabled: false,
        schedule: '0 8 * * *',
        reason: '结合天气或环境上下文，给出一句自然、有用、不过度打扰的关心或提醒。',
        urgent: false,
      },
    },
    followup: {
      enabled: true,
      defaultDelayMinutes: 180,
      dedupeHours: 24,
    },
    deferredReply: {
      enabled: true,
      defaultDelayMinutes: 30,
    },
    generation: {
      enabled: true,
      instruction: DEFAULT_PROACTIVE_INSTRUCTION,
      maxOutputTokens: 240,
      temperature: 0.8,
    },
  },
  web: {
    enabled: true,
    basePath: '/api/ext/virtual-lover',
    panelPath: '/virtual-lover',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readInteger(value: unknown, fallback: number, min?: number): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  const integer = Math.trunc(normalized);
  if (typeof min === 'number' && integer < min) return fallback;
  return integer;
}

function readNumber(value: unknown, fallback: number, min?: number): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  if (typeof min === 'number' && normalized < min) return fallback;
  return normalized;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

function normalizeAgentMode(value: unknown, fallback: VirtualLoverAgentMode): VirtualLoverAgentMode {
  return value === 'multi' || value === 'single' ? value : fallback;
}

function normalizeInjectionMode(value: unknown, fallback: VirtualLoverInjectionMode): VirtualLoverInjectionMode {
  return value === 'replace' || value === 'prepend' ? value : fallback;
}

function normalizeBasePath(value: unknown, fallback: string): string {
  const raw = readString(value, fallback).trim();
  if (!raw) return fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
}

function normalizeSpaceId(value: unknown, fallback: string): string {
  const raw = readString(value, fallback).trim() || fallback;
  return /^[a-zA-Z0-9_-]+$/.test(raw) ? raw : fallback;
}

function normalizeTargetKind(value: unknown, fallback: DeliveryTargetKind): DeliveryTargetKind {
  return value === 'chat' || value === 'user' || value === 'room' || value === 'channel' ? value : fallback;
}

function normalizeDeliveryTarget(raw: unknown, fallback: DeliveryTarget): DeliveryTarget {
  const source = asRecord(raw);
  const rawTarget = source.raw;
  return {
    kind: normalizeTargetKind(source.kind, fallback.kind),
    id: readString(source.id, fallback.id).trim(),
    accountId: readString(source.accountId, fallback.accountId ?? '').trim() || undefined,
    threadId: readString(source.threadId, fallback.threadId ?? '').trim() || undefined,
    raw: rawTarget === undefined ? fallback.raw : rawTarget,
  };
}

function readScheduledStrategy(raw: unknown, fallback: VirtualLoverScheduledStrategyConfig): VirtualLoverScheduledStrategyConfig {
  const source = asRecord(raw);
  return {
    enabled: readBoolean(source.enabled, fallback.enabled),
    schedule: readString(source.schedule, fallback.schedule).trim() || fallback.schedule,
    reason: readString(source.reason, fallback.reason).trim() || fallback.reason,
    urgent: readBoolean(source.urgent, fallback.urgent),
  };
}

function normalizeTimeString(value: unknown, fallback: string): string {
  const raw = readString(value, fallback).trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : fallback;
}

/**
 * 解析 virtual_lover.yaml。
 *
 * 兼容两种写法：
 * 1. 文件本身直接是配置对象；
 * 2. 文件顶层包含 virtual_lover: { ... }。
 *
 * 注意：memory 配置仅引用 Iris memory extension 的命名 space，
 * virtual-lover 不自建存储/检索/dream 技术栈。
 */
export function parseVirtualLoverConfig(raw?: Record<string, unknown>): VirtualLoverConfig {
  const root = asRecord(raw);
  const source = isRecord(root.virtual_lover) ? root.virtual_lover : root;
  const defaults = DEFAULT_VIRTUAL_LOVER_CONFIG;

  const agent = asRecord(source.agent);
  const prompt = asRecord(source.prompt);
  const memory = asRecord(source.memory);
  const memoryTools = asRecord(memory.tools);
  const proactive = asRecord(source.proactive);
  const proactiveGeneration = asRecord(proactive.generation);
  const proactiveStrategies = asRecord(proactive.strategies);
  const proactiveFollowup = asRecord(proactive.followup);
  const proactiveDeferredReply = asRecord(proactive.deferredReply);
  const web = asRecord(source.web);

  return {
    enabled: readBoolean(source.enabled, defaults.enabled),
    agent: {
      mode: normalizeAgentMode(agent.mode, defaults.agent.mode),
      defaultAgentId: readString(agent.defaultAgentId, defaults.agent.defaultAgentId).trim() || defaults.agent.defaultAgentId,
    },
    prompt: {
      enabled: readBoolean(prompt.enabled, defaults.prompt.enabled),
      injectionMode: normalizeInjectionMode(prompt.injectionMode, defaults.prompt.injectionMode),
      priority: readInteger(prompt.priority, defaults.prompt.priority),
      onlyFirstRound: readBoolean(prompt.onlyFirstRound, defaults.prompt.onlyFirstRound),
      useAntml: readBoolean(prompt.useAntml, defaults.prompt.useAntml),
      sections: readStringArray(prompt.sections, defaults.prompt.sections),
    },
    memory: {
      space: normalizeSpaceId(memory.space, defaults.memory.space),
      autoInject: readBoolean(memory.autoInject, defaults.memory.autoInject),
      maxRecallBytes: readInteger(memory.maxRecallBytes, defaults.memory.maxRecallBytes, 0),
      autoExtract: readBoolean(memory.autoExtract, defaults.memory.autoExtract),
      extractInterval: readInteger(memory.extractInterval, defaults.memory.extractInterval, 1),
      tools: {
        enabled: readBoolean(memoryTools.enabled, defaults.memory.tools.enabled),
      },
    },
    proactive: {
      enabled: readBoolean(proactive.enabled, defaults.proactive.enabled),
      platform: readString(proactive.platform, defaults.proactive.platform).trim().toLowerCase() || defaults.proactive.platform,
      policy: readString(proactive.policy, defaults.proactive.policy ?? '').trim() || undefined,
      binding: readString(proactive.binding, defaults.proactive.binding ?? '').trim() || undefined,
      target: normalizeDeliveryTarget(proactive.target, defaults.proactive.target),
      strategies: {
        goodMorning: readScheduledStrategy(proactiveStrategies.goodMorning, defaults.proactive.strategies.goodMorning),
        goodnight: readScheduledStrategy(proactiveStrategies.goodnight, defaults.proactive.strategies.goodnight),
        dailyCheckIn: readScheduledStrategy(proactiveStrategies.dailyCheckIn, defaults.proactive.strategies.dailyCheckIn),
        random: (() => {
          const source = asRecord(proactiveStrategies.random);
          const fallback = defaults.proactive.strategies.random;
          const minPerDay = readInteger(source.minPerDay, fallback.minPerDay, 0);
          const maxPerDay = readInteger(source.maxPerDay, fallback.maxPerDay, 0);
          return {
            enabled: readBoolean(source.enabled, fallback.enabled),
            windowStart: normalizeTimeString(source.windowStart, fallback.windowStart),
            windowEnd: normalizeTimeString(source.windowEnd, fallback.windowEnd),
            minPerDay,
            maxPerDay: Math.max(minPerDay, maxPerDay),
            reason: readString(source.reason, fallback.reason).trim() || fallback.reason,
          };
        })(),
        lateNight: (() => {
          const source = asRecord(proactiveStrategies.lateNight);
          const fallback = defaults.proactive.strategies.lateNight;
          return readScheduledStrategy(source, fallback);
        })(),
        memory: (() => {
          const source = asRecord(proactiveStrategies.memory);
          const fallback = defaults.proactive.strategies.memory;
          return {
            enabled: readBoolean(source.enabled, fallback.enabled),
            schedule: readString(source.schedule, fallback.schedule).trim() || fallback.schedule,
            query: readString(source.query, fallback.query).trim() || fallback.query,
            reason: readString(source.reason, fallback.reason).trim() || fallback.reason,
            urgent: readBoolean(source.urgent, fallback.urgent),
          };
        })(),
        weather: (() => {
          const source = asRecord(proactiveStrategies.weather);
          const fallback = defaults.proactive.strategies.weather;
          return readScheduledStrategy(source, fallback);
        })(),
      },
      followup: {
        enabled: readBoolean(proactiveFollowup.enabled, defaults.proactive.followup.enabled),
        defaultDelayMinutes: readInteger(proactiveFollowup.defaultDelayMinutes, defaults.proactive.followup.defaultDelayMinutes, 1),
        dedupeHours: readInteger(proactiveFollowup.dedupeHours, defaults.proactive.followup.dedupeHours, 1),
      },
      deferredReply: {
        enabled: readBoolean(proactiveDeferredReply.enabled, defaults.proactive.deferredReply.enabled),
        defaultDelayMinutes: readInteger(proactiveDeferredReply.defaultDelayMinutes, defaults.proactive.deferredReply.defaultDelayMinutes, 1),
      },
      generation: {
        enabled: readBoolean(proactiveGeneration.enabled, defaults.proactive.generation.enabled),
        instruction: readString(proactiveGeneration.instruction, defaults.proactive.generation.instruction).trim() || defaults.proactive.generation.instruction,
        maxOutputTokens: readInteger(proactiveGeneration.maxOutputTokens, defaults.proactive.generation.maxOutputTokens, 1),
        temperature: readNumber(proactiveGeneration.temperature, defaults.proactive.generation.temperature, 0),
      },
    },
    web: {
      enabled: readBoolean(web.enabled, defaults.web.enabled),
      basePath: normalizeBasePath(web.basePath, defaults.web.basePath),
      panelPath: normalizeBasePath(web.panelPath, defaults.web.panelPath),
    },
  };
}
