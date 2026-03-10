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
  web: {
    port: number;
    host: string;
    /** 全局 API 认证令牌（可选，启用后 /api/* 需 Authorization: Bearer <token>） */
    authToken?: string;
    /** 管理面令牌（可选，启用后 /api/config /api/deploy/* /api/cloudflare/* 需 X-Management-Token） */
    managementToken?: string;
  };
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
  /** 子代理最大嵌套深度，默认 3 */
  maxAgentDepth: number;
}

export interface MemoryConfig {
  /** 是否启用记忆，默认 false */
  enabled: boolean;
  /** 数据库路径，默认 ./data/memory.db */
  dbPath?: string;
}

export interface CloudflareConfig {
  /** 明文 token（兼容旧配置） */
  apiToken?: string;
  /** 从环境变量读取 token（优先） */
  apiTokenEnv?: string;
  /** 从文件读取 token（次优先） */
  apiTokenFile?: string;
  /** zoneId，可为 auto */
  zoneId: string;
}

export interface MCPServerConfig {
  transport: 'stdio' | 'http';
  command?: string;        // stdio
  args?: string[];         // stdio
  env?: Record<string, string>;  // stdio
  cwd?: string;            // stdio
  url?: string;            // http
  headers?: Record<string, string>;  // http
  timeout?: number;        // 通用，默认 30000
  enabled?: boolean;       // 通用，默认 true
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface AppConfig {
  llm: TieredLLMConfig;
  platform: PlatformConfig;
  storage: StorageConfig;
  system: SystemConfig;
  memory?: MemoryConfig;
  cloudflare?: CloudflareConfig;
  mcp?: MCPConfig;
}
