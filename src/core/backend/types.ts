/**
 * Backend 公共类型、接口与常量
 */

import type { LLMConfig, ToolsConfig, SkillDefinition, SummaryConfig } from '../../config/types';
import type { OCRProvider } from '../../ocr';
import type { Part, Content, UsageMetadata, ToolInvocation, ToolAttachment } from '../../types';

// ============ 常量 ============

export const IMAGE_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 张图片，但当前模型无法查看图片内容]`
    : '[用户发送了 1 张图片，但当前模型无法查看图片内容]'
);

export const DOCUMENT_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 个文档，但当前模型无法查看文档内容]`
    : '[用户发送了 1 个文档，但当前模型无法查看文档内容]'
);

/** Backend 内部最多保留多少组 redo 历史。与 Console 旧实现保持一致。 */
export const MAX_REDO_HISTORY_GROUPS = 200;

// ============ Undo/Redo 类型 ============

/**
 * undo 的粒度。
 *
 * - last-visible-message：撤销最后一个"可见消息单元"。
 *   - 若历史末尾是 assistant 回复，则会删除整段 assistant 回复（含中间 tool response）。
 *   - 若历史末尾是普通 user 消息，则只删除该 user 消息。
 * - last-turn：撤销最后一轮完整交互。
 *   - 若历史末尾是 assistant 回复，则同时删除其前面的 user 消息。
 *   - 若历史末尾是普通 user 消息，则退化为只删除该 user 消息。
 */
export type UndoScope = 'last-visible-message' | 'last-turn';

export interface UndoOperationResult {
  scope: UndoScope;
  removed: Content[];
  removedCount: number;
  userText: string;
  assistantText: string;
}

export interface RedoOperationResult {
  restored: Content[];
  restoredCount: number;
  userText: string;
  assistantText: string;
}

// ============ 输入类型 ============

export interface ImageInput {
  mimeType: string;
  data: string;
}

export type { DocumentInput } from '../../media/document-extract.js';

// ============ 配置与事件 ============

export interface BackendConfig {
  /** 工具执行最大轮次 */
  maxToolRounds?: number;
  /** LLM 调用报错时是否自动重试 */
  retryOnError?: boolean;
  /** 自动重试最大次数 */
  maxRetries?: number;
  /** 工具执行策略配置 */
  toolsConfig?: ToolsConfig;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 子代理协调指导文本 */
  subAgentGuidance?: string;
  /** 默认模式名称 */
  defaultMode?: string;
  /** 当前活动模型配置（用于 vision 能力判定） */
  currentLLMConfig?: LLMConfig;
  /** OCR 服务（当主模型不支持 vision 时回退使用） */
  ocrService?: OCRProvider;
  /** 用于 /compact 上下文压缩的模型名称（需在 LLMRouter 中已注册） */
  summaryModelName?: string;
  /** 上下文压缩提示词配置 */
  summaryConfig?: SummaryConfig;
  /** Skill 定义列表 */
  skills?: SkillDefinition[];
  /** 配置目录路径（用于 rememberPlatformModel 写回 platform.yaml） */
  configDir?: string;
  /** 是否记住各平台上次使用的模型 */
  rememberPlatformModel?: boolean;
}

export interface BackendEvents {
  /** 非流式最终回复 */
  'response': (sessionId: string, text: string) => void;
  /** 流式段开始 */
  'stream:start': (sessionId: string) => void;
  /** 流式结构化 part 增量（按顺序） */
  'stream:parts': (sessionId: string, parts: Part[]) => void;
  /** 流式文本块 */
  'stream:chunk': (sessionId: string, chunk: string) => void;
  /** 流式段结束 */
  'stream:end': (sessionId: string, usage?: UsageMetadata) => void;
  /** 工具状态变更 */
  'tool:update': (sessionId: string, invocations: ToolInvocation[]) => void;
  /** 处理出错 */
  'error': (sessionId: string, error: string) => void;
  /** Token 用量（每轮 LLM 调用后发出） */
  'usage': (sessionId: string, usage: UsageMetadata) => void;
  /** LLM 调用重试（attempt 从 1 开始，maxRetries 为允许的最大重试次数） */
  'retry': (sessionId: string, attempt: number, maxRetries: number, error: string) => void;
  /** 用户输入折算后的 token 数（估算值） */
  'user:token': (sessionId: string, tokenCount: number) => void;
  /** 当前用户回合完成（统一耗时来源） */
  'done': (sessionId: string, durationMs: number) => void;
  /** 一轮模型输出完成后的完整内容（结构化） */
  'assistant:content': (sessionId: string, content: Content) => void;
  /** 自动上下文压缩完成（阈值触发） */
  'auto-compact': (sessionId: string, summaryText: string) => void;
  /**
   * 工具执行产生的附件（例如 MCP 生图结果）。
   *
   * 这里是平台层的旁路通道：附件不进入 LLM 上下文，
   * 由具体平台自己决定如何发送给用户。
   */
  'attachments': (sessionId: string, attachments: ToolAttachment[]) => void;
}
