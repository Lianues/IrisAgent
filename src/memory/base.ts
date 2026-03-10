/**
 * 记忆提供商抽象基类
 *
 * 定义记忆系统的核心接口，所有记忆存储实现继承此类。
 */

import { MemoryEntry } from './types';

export abstract class MemoryProvider {
  /** 添加一条记忆，返回记忆 ID */
  abstract add(content: string, category?: string): Promise<number>;

  /** 全文搜索记忆 */
  abstract search(query: string, limit?: number): Promise<MemoryEntry[]>;

  /** 列出记忆（可按分类过滤） */
  abstract list(category?: string, limit?: number): Promise<MemoryEntry[]>;

  /** 删除一条记忆，返回是否成功 */
  abstract delete(id: number): Promise<boolean>;

  /** 清空所有记忆 */
  abstract clear(): Promise<void>;

  /**
   * 根据用户输入构建记忆上下文文本，供注入系统提示词。
   * 返回 undefined 表示无相关记忆。子类可覆写自定义格式。
   */
  async buildContext(userText: string, limit: number = 5): Promise<string | undefined> {
    if (!userText) return undefined;
    const memories = await this.search(userText, limit);
    if (memories.length === 0) return undefined;
    const lines = memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
    return `\n\n## 长期记忆\n以下是与当前对话可能相关的记忆：\n${lines}`;
  }
}
