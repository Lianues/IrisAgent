/**
 * Manifest 解析工具
 *
 * 归集 core utils.ts / terminal runtime.ts 中重复的 manifest 读取逻辑。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeText } from './paths.js';
import type { ExtensionManifestLike } from './types.js';

export const MANIFEST_FILE = 'manifest.json';

/**
 * 解析 extension manifest 原始数据。
 * 只校验必要字段 (name, version)，返回松散类型 ExtensionManifestLike。
 *
 * core 的严格类型 ExtensionManifest 天然兼容此返回值。
 */
export function parseExtensionManifest(raw: unknown, sourceLabel: string): ExtensionManifestLike {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`extension manifest 格式无效，应为对象: ${sourceLabel}`);
  }

  const manifest = raw as ExtensionManifestLike;
  if (!normalizeText(manifest.name)) {
    throw new Error(`extension manifest 缺少 name: ${sourceLabel}`);
  }
  if (!normalizeText(manifest.version)) {
    throw new Error(`extension manifest 缺少 version: ${sourceLabel}`);
  }

  return manifest;
}

/**
 * 从目录读取 manifest.json。
 * 文件不存在或解析失败时返回 undefined（容错版）。
 */
export function readManifestFromDir(rootDir: string): ExtensionManifestLike | undefined {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return parseExtensionManifest(raw, manifestPath);
  } catch {
    return undefined;
  }
}
