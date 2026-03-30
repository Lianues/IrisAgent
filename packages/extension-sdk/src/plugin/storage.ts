import type { Content } from '../message.js';
import type { IrisSessionMetaLike } from '../platform.js';

/** @deprecated 请使用 IrisSessionMetaLike */
export type SessionInfoLike = IrisSessionMetaLike;

/** 类型化存储接口（替代 IrisAPI.storage 的 unknown） */
export interface StorageLike {
  getHistory(sessionId: string): Promise<unknown[]>;
  clearHistory(sessionId: string): Promise<void>;
  truncateHistory(sessionId: string, keepCount: number): Promise<void>;
  listSessions(): Promise<string[]>;
  listSessionMetas(): Promise<SessionInfoLike[]>;
  /** 向指定会话追加一条消息 */
  addMessage?(sessionId: string, content: Content): Promise<void>;
  /** 更新指定会话最后一条消息（用于补充 durationMs 等元信息） */
  updateLastMessage?(sessionId: string, updater: (content: Content) => Content): Promise<void>;
  /** 获取会话元数据 */
  getMeta?(sessionId: string): Promise<SessionInfoLike | null>;
  /** 保存/更新会话元数据 */
  saveMeta?(meta: SessionInfoLike): Promise<void>;
}
