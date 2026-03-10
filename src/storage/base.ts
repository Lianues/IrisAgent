/**
 * 聊天记录存储层 —— 存储提供商基类
 *
 * 所有存储实现（JSON 文件、数据库等）均需继承此基类。
 * 存储层负责：
 *   1. 按 sessionId 管理聊天记录
 *   2. 以 Gemini Content 格式存取消息
 *   3. 存储包括用户消息、模型回复、工具调用及结果
 */

import { Content } from '../types';

export abstract class StorageProvider {
  /** 获取指定会话的全部历史消息 */
  abstract getHistory(sessionId: string): Promise<Content[]>;

  /** 向指定会话追加一条消息 */
  abstract addMessage(sessionId: string, content: Content): Promise<void>;

  /** 清空指定会话的历史 */
  abstract clearHistory(sessionId: string): Promise<void>;

  /** 截断历史：只保留前 keepCount 条消息，删除之后的所有消息 */
  abstract truncateHistory(sessionId: string, keepCount: number): Promise<void>;

  /** 列出所有会话 ID */
  abstract listSessions(): Promise<string[]>;

  /** 存储提供商名称 */
  get name(): string {
    return this.constructor.name;
  }

  /** 统一 Content 的字段顺序：role → parts → usageMetadata → 其余 */
  protected normalize(content: Content): Content {
    const known = new Set(['role', 'parts', 'usageMetadata']);
    const normalized: Content = {
      role: content.role,
      parts: content.parts,
    };
    if (content.usageMetadata) {
      normalized.usageMetadata = content.usageMetadata;
    }
    // 保留 Gemini API 可能附加的其他未知字段
    for (const [k, v] of Object.entries(content)) {
      if (!known.has(k)) {
        (normalized as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return normalized;
  }
}
