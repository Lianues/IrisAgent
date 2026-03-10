/**
 * 记忆配置解析
 */

import { MemoryConfig } from './types';

export function parseMemoryConfig(raw: any): MemoryConfig {
  if (!raw) return { enabled: false };
  return {
    enabled: raw.enabled ?? false,
    dbPath: raw.dbPath,
  };
}
