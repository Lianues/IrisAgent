/**
 * 存储配置解析
 */

import { StorageConfig } from './types';

export function parseStorageConfig(raw: any = {}): StorageConfig {
  return {
    type: (raw.type ?? 'json-file') as StorageConfig['type'],
    dir: raw.dir ?? './data/sessions',
    dbPath: raw.dbPath,
  };
}
