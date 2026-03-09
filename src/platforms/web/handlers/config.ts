/**
 * 配置管理 API 处理器
 *
 * GET /api/config — 读取配置（API Key 脱敏）
 * PUT /api/config — 更新配置
 */

import * as http from 'http';
import * as fs from 'fs';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { readBody, sendJSON } from '../router';

/** 脱敏处理：保留后4位 */
function maskSensitive(value: string): string {
  if (!value || value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

/** 对配置对象中的敏感字段脱敏 */
function sanitizeConfig(data: any): any {
  const result = JSON.parse(JSON.stringify(data));
  // LLM API Key（支持三层格式和旧扁平格式）
  for (const tier of ['primary', 'secondary', 'light']) {
    if (result.llm?.[tier]?.apiKey) {
      result.llm[tier].apiKey = maskSensitive(result.llm[tier].apiKey);
    }
  }
  // 兼容旧扁平格式
  if (result.llm?.apiKey) {
    result.llm.apiKey = maskSensitive(result.llm.apiKey);
  }
  // Discord token
  if (result.platform?.discord?.token) {
    result.platform.discord.token = maskSensitive(result.platform.discord.token);
  }
  // Telegram token
  if (result.platform?.telegram?.token) {
    result.platform.telegram.token = maskSensitive(result.platform.telegram.token);
  }
  // Cloudflare API Token
  if (result.cloudflare?.apiToken) {
    result.cloudflare.apiToken = maskSensitive(result.cloudflare.apiToken);
  }
  return result;
}

/** 检查值是否为脱敏占位符 */
function isMasked(value: string): boolean {
  return typeof value === 'string' && value.startsWith('****');
}

/** 危险的键名，防止原型链污染 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 深合并，跳过脱敏值和危险键，null 表示删除该键 */
function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const val = source[key];
    if (val === null) { delete result[key]; continue; } // null → 删除键
    if (typeof val === 'string' && isMasked(val)) continue; // 跳过脱敏值
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] ?? {}, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function createConfigHandlers(configPath: string, onReload?: (mergedConfig: any) => void) {
  return {
    /** GET /api/config */
    async get(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const data = parseYAML(raw) ?? {};
        sendJSON(res, 200, sanitizeConfig(data));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `读取配置失败: ${msg}` });
      }
    },

    /** PUT /api/config */
    async update(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const updates = await readBody(req);
        const raw = fs.readFileSync(configPath, 'utf-8');
        const current = parseYAML(raw) ?? {};
        const merged = deepMerge(current, updates);

        // 旧扁平格式 → 三层格式迁移：将顶层 apiKey 迁入 primary，然后删除旧字段
        if (merged.llm?.primary && merged.llm?.provider) {
          if (!merged.llm.primary.apiKey && merged.llm.apiKey) {
            merged.llm.primary.apiKey = merged.llm.apiKey;
          }
          delete merged.llm.provider;
          delete merged.llm.apiKey;
          delete merged.llm.model;
          delete merged.llm.baseUrl;
        }

        fs.writeFileSync(configPath, stringifyYAML(merged, { indent: 2 }), 'utf-8');

        // 热重载：写完文件后通知调用方更新内存状态
        let reloaded = false;
        if (onReload) {
          try {
            onReload(merged);
            reloaded = true;
          } catch {
            // 热重载失败时回退为需要重启
          }
        }
        sendJSON(res, 200, { ok: true, restartRequired: !reloaded });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `更新配置失败: ${msg}` });
      }
    },
  };
}
