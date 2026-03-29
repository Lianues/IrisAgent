/**
 * 配置管理辅助工具
 *
 * 提供脱敏、深合并，以及基于 data/configs 目录的可编辑配置读写能力。
 */

import { loadRawConfigDir, writeRawConfigDir } from './raw';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function maskSensitive(value: string): string {
  if (!value || value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

export function isMasked(value: string): boolean {
  return typeof value === 'string' && value.startsWith('****');
}

function sanitizeLLMConfig(result: any): void {
  if (result.llm?.models && typeof result.llm.models === 'object') {
    for (const model of Object.values(result.llm.models) as any[]) {
      if (model?.apiKey) {
        model.apiKey = maskSensitive(String(model.apiKey));
      }
    }
  }
}

/**
 * @param extensionPasswordFields 可选，扩展平台中 type: "password" 的字段映射。
 *   key = 平台名，value = 该平台的 password 字段名集合。
 *   不传时回退到通用正则匹配（key/secret/token/password）。
 */
export function sanitizeConfig(data: any, extensionPasswordFields?: Map<string, Set<string>>): any {
  const result = JSON.parse(JSON.stringify(data ?? {}));

  sanitizeLLMConfig(result);

  if (result.ocr?.apiKey) {
    result.ocr.apiKey = maskSensitive(String(result.ocr.apiKey));
  }

  // 内置 Web 平台固定脱敏
  if (result.platform?.web?.authToken) {
    result.platform.web.authToken = maskSensitive(String(result.platform.web.authToken));
  }
  if (result.platform?.web?.managementToken) {
    result.platform.web.managementToken = maskSensitive(String(result.platform.web.managementToken));
  }

  // 扩展平台动态脱敏：根据 manifest 中 type: "password" 的字段
  if (result.platform && typeof result.platform === 'object') {
    const RESERVED = new Set(['type', 'pairing', 'web']);
    for (const [platformName, platformConfig] of Object.entries(result.platform)) {
      if (RESERVED.has(platformName) || !platformConfig || typeof platformConfig !== 'object') continue;
      const section = platformConfig as Record<string, unknown>;
      const passwordKeys = extensionPasswordFields?.get(platformName);
      if (passwordKeys) {
        // 精确脱敏：根据 manifest 声明
        for (const key of passwordKeys) {
          if (section[key] && typeof section[key] === 'string') {
            section[key] = maskSensitive(String(section[key]));
          }
        }
      } else {
        // 通用回退：正则匹配 key/secret/token/password
        for (const key of Object.keys(section)) {
          if (/key|secret|token|password/i.test(key) && typeof section[key] === 'string') {
            section[key] = maskSensitive(String(section[key]));
          }
        }
      }
    }
  }

  if (result.cloudflare?.apiToken) {
    result.cloudflare.apiToken = maskSensitive(String(result.cloudflare.apiToken));
  }

  if (Array.isArray(result.plugins)) {
    for (const p of result.plugins) {
      if (p?.config && typeof p.config === 'object') {
        for (const key of Object.keys(p.config)) {
          if (/key|secret|token|password/i.test(key)) {
            p.config[key] = maskSensitive(String(p.config[key] ?? ''));
          }
        }
      }
    }
  }

  if (result.mcp?.servers && typeof result.mcp.servers === 'object') {
    for (const server of Object.values(result.mcp.servers) as any[]) {
      if (!server?.headers) continue;
      for (const key of Object.keys(server.headers)) {
        if (key.toLowerCase() === 'authorization') {
          server.headers[key] = maskSensitive(String(server.headers[key] ?? ''));
        }
      }
    }
  }

  return result;
}

export function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;

  const result = Array.isArray(target)
    ? [...target]
    : target && typeof target === 'object'
      ? { ...target }
      : {};

  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;

    const value = source[key];

    if (value === null) {
      delete result[key];
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }

    if (value && typeof value === 'object') {
      result[key] = deepMerge(result[key] ?? {}, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function normalizeMergedConfig(data: any): any {
  const merged = JSON.parse(JSON.stringify(data ?? {}));

  if (merged.llm?.models && typeof merged.llm.models === 'object' && !Array.isArray(merged.llm.models)) {
    delete merged.llm.provider;
    delete merged.llm.apiKey;
    delete merged.llm.model;
    delete merged.llm.baseUrl;

    const modelNames = Object.keys(merged.llm.models).filter(modelName => {
      const model = merged.llm.models[modelName];
      return model && typeof model === 'object' && !Array.isArray(model);
    });

    if (modelNames.length === 0) {
      delete merged.llm;
    } else if (!merged.llm.defaultModel || !merged.llm.models[merged.llm.defaultModel]) {
      merged.llm.defaultModel = modelNames[0];
    }
  }

  if (!merged.mcp?.servers || typeof merged.mcp.servers !== 'object' || Object.keys(merged.mcp.servers).length === 0) {
    delete merged.mcp;
  }

  return merged;
}

export function readEditableConfig(configDir: string): any {
  return JSON.parse(JSON.stringify(loadRawConfigDir(configDir) ?? {}));
}

export function updateEditableConfig(configDir: string, updates: any): { mergedRaw: any; sanitized: any } {
  const current = loadRawConfigDir(configDir);
  const mergedRaw = normalizeMergedConfig(deepMerge(current, updates));
  writeRawConfigDir(configDir, mergedRaw);
  return {
    mergedRaw,
    sanitized: sanitizeConfig(mergedRaw),
  };
}
