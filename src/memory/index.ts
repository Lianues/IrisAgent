/**
 * 记忆模块入口
 */

export { MemoryProvider } from './base';
export { SqliteMemory } from './sqlite';
export { createMemoryTools } from './tools';
export type { MemoryEntry } from './types';

import { MemoryProvider } from './base';
import { SqliteMemory } from './sqlite';

/** 记忆模块自身的创建选项 */
export interface MemoryProviderOptions {
  dbPath?: string;
}

/** 根据选项创建记忆提供商实例 */
export function createMemoryProvider(options?: MemoryProviderOptions): MemoryProvider {
  return new SqliteMemory(options?.dbPath);
}
