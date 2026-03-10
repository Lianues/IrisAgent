/**
 * 配置模块统一入口
 *
 * 从 data/configs/ 目录加载分文件配置。
 *
 * data/configs/ 目录结构：
 *   llm.yaml      - LLM 配置
 *   platform.yaml - 平台配置
 *   storage.yaml  - 存储配置
 *   system.yaml   - 系统配置
 *   memory.yaml   - 记忆配置（可选）
 *   mcp.yaml      - MCP 配置（可选）
 *   modes.yaml    - 模式配置（可选）
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
import { parseMCPConfig } from './mcp';
import { parseModeConfig } from './mode';

export type { AppConfig, LLMConfig, TieredLLMConfig, PlatformConfig, StorageConfig, SystemConfig, MemoryConfig, MCPConfig, MCPServerConfig } from './types';

/** 配置目录 */
const CONFIGS_DIR = 'data/configs';

/** 文件名 → 配置键 的映射 */
const FILE_KEY_MAP: Record<string, string> = {
  'llm': 'llm',
  'platform': 'platform',
  'storage': 'storage',
  'system': 'system',
  'memory': 'memory',
  'mcp': 'mcp',
  'modes': 'modes',
};

/**
 * 安全读取并解析一个 YAML 文件，文件不存在时返回 undefined。
 */
function readYamlFile(filePath: string): any | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath,'utf-8');
  return parseYAML(raw) ?? undefined;
}

/**
 * 返回配置目录的绝对路径。
 */
export function findConfigFile(): string {
  const configsDir = path.resolve(process.cwd(), CONFIGS_DIR);
  if (fs.existsSync(configsDir) && fs.statSync(configsDir).isDirectory()) {
    return configsDir;
  }

  throw new Error(
    `未找到配置目录 ${CONFIGS_DIR}/。` +
    `请复制 data/configs.example/ 为 data/configs/ 并填入实际值。`,
  );
}

/**
 * 从 data/configs/ 目录加载分文件配置。
 */
function loadFromDir(dir: string): Record<string, any> {
  const data: Record<string, any> = {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    const key = path.basename(file, path.extname(file));
    const mappedKey = FILE_KEY_MAP[key];
    if (!mappedKey) continue;

    const content = readYamlFile(path.join(dir, file));
    if (content !== undefined) {
      data[mappedKey] = content;
    }
  }

  return data;
}

/** 加载配置 */
export function loadConfig(): AppConfig {
  const configsDir = findConfigFile();
  const data = loadFromDir(configsDir);

  return {
    llm: parseTieredLLMConfig(data.llm),
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage),
    system: parseSystemConfig(data.system),
    memory: parseMemoryConfig(data.memory),
    mcp: parseMCPConfig(data.mcp),
    modes: parseModeConfig(data.modes),
  };
}
