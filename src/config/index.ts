/**
 *配置模块统一入口
 *
 * 从项目根目录的 config.yaml 加载配置。
 * 各子配置独立解析，新增配置项只需修改对应的子文件。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import { AppConfig } from './types';
import { parseTieredLLMConfig } from './llm';
import { parsePlatformConfig } from './platform';
import { parseStorageConfig } from './storage';
import { parseSystemConfig } from './system';
import { parseMemoryConfig } from './memory';

export type { AppConfig, LLMConfig, TieredLLMConfig, PlatformConfig, StorageConfig, SystemConfig, MemoryConfig, CloudflareConfig } from './types';

/** 配置文件搜索顺序 */
const CONFIG_PATHS = [
  'config.yaml',
  'config.yml',
];

/** 查找配置文件 */
export function findConfigFile(): string {
  for (const name of CONFIG_PATHS) {
    const full = path.resolve(process.cwd(), name);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(
    `未找到配置文件。请复制 config.example.yaml 为 config.yaml 并填入实际值。\n` +
    `搜索路径: ${CONFIG_PATHS.join(', ')}`,
  );
}

/** 解析可选的 Cloudflare 配置 */
function parseCloudflareConfig(data: any) {
  if (!data) return undefined;
  return {
    apiToken: data.apiToken || '',
    zoneId: data.zoneId || '',
  };
}

/** 从 config.yaml 加载配置 */
export function loadConfig(): AppConfig {
  const configPath = findConfigFile();
  const raw = fs.readFileSync(configPath, 'utf-8');
  const data = parseYAML(raw) ?? {};

  return {
    llm: parseTieredLLMConfig(data.llm),
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage),
    system: parseSystemConfig(data.system),
    memory: parseMemoryConfig(data.memory),
    cloudflare: parseCloudflareConfig(data.cloudflare),
  };
}
