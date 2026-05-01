/**
 * 记忆插件配置解析
 */

export interface MemoryConsolidationConfig {
  enabled: boolean;
  /** 两次归纳之间的最小间隔（小时） */
  minHours: number;
  /** 触发归纳的最少新会话数 */
  minSessions: number;
}

export interface MemorySpaceConfig {
  /** 是否启用该命名记忆空间 */
  enabled: boolean;
  /** 该 space 的存储文件路径（相对于 memory extension dataDir，或绝对路径） */
  dbPath?: string;
  /** 指定该 space 内部检索/归纳使用的模型；不填则使用 memory 顶层 model */
  model?: string;
  /** 单次 buildContext 注入上限 */
  maxContextBytes: number;
  /** 非 user 类型未注入记忆 <= 此数时，跳过 LLM 选择器直接注入全部 */
  smallSetThreshold: number;
  /** 该 space 的归纳配置 */
  consolidation: MemoryConsolidationConfig;
}

export interface MemoryPluginConfig {
  enabled: boolean;
  dbPath?: string;

  /** 指定记忆系统内部调用（提取/归纳/检索）使用的模型；不填则使用当前活动模型 */
  model?: string;

  // Phase 2: 自动提取
  autoExtract: boolean;
  /** 每 N 轮提取一次 */
  extractInterval: number;

  // Phase 3: 智能检索
  autoRecall: boolean;
  /** 每轮注入记忆的最大字节数 */
  maxContextBytes: number;
  /** 会话级记忆注入总字节上限 */
  sessionBudgetBytes: number;
  /** 非 user 类型未注入记忆 <= 此数时，跳过 LLM 选择器直接注入全部 */
  smallSetThreshold: number;

  // Phase 4: 跨会话归纳
  consolidation: MemoryConsolidationConfig;

  /** 命名记忆空间。用于 companion / project 等独立记忆域。 */
  spaces: Record<string, MemorySpaceConfig>;
}

/** 默认归纳配置 */
export const DEFAULT_CONSOLIDATION_CONFIG: MemoryConsolidationConfig = {
  enabled: true,
  minHours: 24,
  minSessions: 3,
};

/** 命名记忆空间默认配置 */
export const DEFAULT_SPACE_CONFIG: MemorySpaceConfig = {
  enabled: true,
  model: undefined,
  maxContextBytes: 20480,
  smallSetThreshold: 15,
  consolidation: DEFAULT_CONSOLIDATION_CONFIG,
};

/** 默认配置 */
export const DEFAULT_CONFIG: MemoryPluginConfig = {
  enabled: false,
  model: undefined,
  autoExtract: true,
  extractInterval: 1,
  autoRecall: true,
  maxContextBytes: 20480,       // 20KB per turn
  sessionBudgetBytes: 61440,    // 60KB per session
  smallSetThreshold: 15,
  consolidation: DEFAULT_CONSOLIDATION_CONFIG,
  spaces: {},
};

/**
 * 从原始 YAML 解析配置，与默认值合并。
 */
export function resolveConfig(
  rawSection: Record<string, unknown> | undefined,
  pluginConfig: Partial<MemoryPluginConfig> | undefined,
): MemoryPluginConfig {
  const source = (rawSection ?? pluginConfig ?? {}) as Record<string, unknown>;
  const consolidation = resolveConsolidationConfig(source.consolidation, DEFAULT_CONFIG.consolidation);

  const baseConfig: MemoryPluginConfig = {
    enabled: toBool(source.enabled, DEFAULT_CONFIG.enabled),
    dbPath: toOptionalString(source.dbPath),
    model: toOptionalString(source.model) || DEFAULT_CONFIG.model,
    autoExtract: toBool(source.autoExtract, DEFAULT_CONFIG.autoExtract),
    extractInterval: toNum(source.extractInterval, DEFAULT_CONFIG.extractInterval),
    autoRecall: toBool(source.autoRecall, DEFAULT_CONFIG.autoRecall),
    maxContextBytes: toNum(source.maxContextBytes, DEFAULT_CONFIG.maxContextBytes),
    sessionBudgetBytes: toNum(source.sessionBudgetBytes, DEFAULT_CONFIG.sessionBudgetBytes),
    smallSetThreshold: toNum(source.smallSetThreshold, DEFAULT_CONFIG.smallSetThreshold),
    consolidation,
    spaces: {},
  };

  baseConfig.spaces = resolveSpacesConfig(source.spaces, baseConfig);
  return baseConfig;
}

export function resolveSpaceConfig(raw: unknown, base: MemoryPluginConfig = DEFAULT_CONFIG): MemorySpaceConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    enabled: toBool(source.enabled, DEFAULT_SPACE_CONFIG.enabled),
    dbPath: toOptionalString(source.dbPath),
    model: toOptionalString(source.model) || base.model || DEFAULT_SPACE_CONFIG.model,
    maxContextBytes: toNum(source.maxContextBytes, base.maxContextBytes ?? DEFAULT_SPACE_CONFIG.maxContextBytes),
    smallSetThreshold: toNum(source.smallSetThreshold, base.smallSetThreshold ?? DEFAULT_SPACE_CONFIG.smallSetThreshold),
    consolidation: resolveConsolidationConfig(source.consolidation, base.consolidation ?? DEFAULT_SPACE_CONFIG.consolidation),
  };
}

function resolveSpacesConfig(raw: unknown, base: MemoryPluginConfig): Record<string, MemorySpaceConfig> {
  if (!isRecord(raw)) return {};
  const spaces: Record<string, MemorySpaceConfig> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id.trim()) continue;
    spaces[id] = resolveSpaceConfig(value, base);
  }
  return spaces;
}

function resolveConsolidationConfig(raw: unknown, fallback: MemoryConsolidationConfig): MemoryConsolidationConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    enabled: toBool(source.enabled, fallback.enabled),
    minHours: toNum(source.minHours, fallback.minHours),
    minSessions: toNum(source.minSessions, fallback.minSessions),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBool(val: unknown, def: boolean): boolean {
  if (typeof val === 'boolean') return val;
  return def;
}

function toNum(val: unknown, def: number): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  const parsed = typeof val === 'string' ? Number(val) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return def;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
