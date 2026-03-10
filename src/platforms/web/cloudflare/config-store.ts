/**
 * Cloudflare 配置存储与密钥来源解析
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import {
  CloudflareCredentialsResult,
  CloudflareTokenSource,
  ResolvedCloudflareCredentials,
  StoredCloudflareConfig,
} from './types';

/** 读取整个 YAML 配置对象 */
function readConfigFile(configPath: string): any {
  const raw = fs.readFileSync(configPath, 'utf-8');
  return parseYAML(raw) ?? {};
}

/** 写回整个 YAML 配置对象 */
function writeConfigFile(configPath: string, data: any): void {
  fs.writeFileSync(configPath, stringifyYAML(data, { indent: 2 }), 'utf-8');
}

/** 解析存储在 config.yaml 中的 Cloudflare 配置 */
export function readStoredCloudflareConfig(configPath: string): StoredCloudflareConfig | null {
  try {
    const data = readConfigFile(configPath);
    if (!data.cloudflare) return null;

    const cfg: StoredCloudflareConfig = {
      apiToken: typeof data.cloudflare.apiToken === 'string' ? data.cloudflare.apiToken : undefined,
      apiTokenEnv: typeof data.cloudflare.apiTokenEnv === 'string' ? data.cloudflare.apiTokenEnv : undefined,
      apiTokenFile: typeof data.cloudflare.apiTokenFile === 'string' ? data.cloudflare.apiTokenFile : undefined,
      zoneId: typeof data.cloudflare.zoneId === 'string' ? data.cloudflare.zoneId : undefined,
    };

    if (!cfg.apiToken && !cfg.apiTokenEnv && !cfg.apiTokenFile) return null;
    return cfg;
  } catch {
    return null;
  }
}

/** 解析 token 来源类型 */
function detectTokenSource(config: StoredCloudflareConfig | null): CloudflareTokenSource | null {
  if (!config) return null;
  if (config.apiTokenEnv) return 'env';
  if (config.apiTokenFile) return 'file';
  if (config.apiToken) return 'inline';
  return null;
}

/** 解析环境变量中的 token */
function resolveTokenFromEnv(envName: string): string {
  const token = process.env[envName]?.trim();
  if (!token) throw new Error(`Cloudflare Token 环境变量未设置或为空: ${envName}`);
  return token;
}

/** 解析文件中的 token */
function resolveTokenFromFile(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const token = fs.readFileSync(absolutePath, 'utf-8').trim();
  if (!token) throw new Error(`Cloudflare Token 文件为空: ${absolutePath}`);
  return token;
}

/** 解析 Cloudflare 凭据（优先级：env > file > inline） */
export function resolveCloudflareCredentials(configPath: string): CloudflareCredentialsResult {
  const stored = readStoredCloudflareConfig(configPath);
  const tokenSource = detectTokenSource(stored);

  if (!stored || !tokenSource) {
    return { configured: false, stored, resolved: null };
  }

  try {
    let apiToken = '';
    switch (tokenSource) {
      case 'env':
        apiToken = resolveTokenFromEnv(stored.apiTokenEnv!);
        break;
      case 'file':
        apiToken = resolveTokenFromFile(stored.apiTokenFile!);
        break;
      case 'inline':
      default:
        apiToken = stored.apiToken?.trim() || '';
        if (!apiToken) throw new Error('Cloudflare Token 为空');
        break;
    }

    const resolved: ResolvedCloudflareCredentials = {
      apiToken,
      zoneId: stored.zoneId || '',
      tokenSource,
    };

    return { configured: true, stored, resolved };
  } catch (err: unknown) {
    return {
      configured: true,
      stored,
      resolved: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 保存由 Web GUI 设置的内联 token 配置 */
export function saveInlineCloudflareConfig(configPath: string, apiToken: string, zoneId: string): void {
  const data = readConfigFile(configPath);
  data.cloudflare = {
    apiToken,
    zoneId,
  };
  writeConfigFile(configPath, data);
}
