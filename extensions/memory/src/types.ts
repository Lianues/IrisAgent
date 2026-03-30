/**
 * 记忆类型定义
 */

/** 一条记忆条目 */
export interface MemoryEntry {
  /** 唯一 ID */
  id: number;
  /** 记忆内容 */
  content: string;
  /** 分类：user / fact / preference / note */
  category: string;
  /** 创建时间戳（秒） */
  createdAt: number;
  /** 更新时间戳（秒） */
  updatedAt: number;
}
