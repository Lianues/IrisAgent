/**
 * 配置类型定义
 */

export interface LLMConfig {
  provider: 'gemini' | 'openai-compatible' | 'claude';
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** 三层 LLM 配置：primary 必填，secondary/light 可选（未配置时自动向上回退） */
export interface TieredLLMConfig {
  primary: LLMConfig;
  secondary?: LLMConfig;
  light?: LLMConfig;
}

export interface PlatformConfig {
  type: 'console' | 'discord' | 'telegram' | 'web';
  discord: { token: string };
  telegram: { token: string };
  web: { port: number; host: string; authToken?: string };
}

export interface StorageConfig {
  type: 'json-file' | 'sqlite';
  dir: string;
  dbPath?: string;
}

export interface SystemConfig {
  systemPrompt: string;
  maxToolRounds: number;
  stream: boolean;
}

export interface MemoryConfig {
  /** 是否启用记忆，默认 false */
  enabled: boolean;
  /** 数据库路径，默认 ./data/memory.db */
  dbPath?: string;
}

export interface CloudflareConfig {
  apiToken: string;
  zoneId: string;
}

export interface AppConfig {
  llm: TieredLLMConfig;
  platform: PlatformConfig;
  storage: StorageConfig;
  system: SystemConfig;
  memory?: MemoryConfig;
  cloudflare?: CloudflareConfig;
}
