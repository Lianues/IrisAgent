/**
 * 远程仓库工具
 *
 * 归集 core installer.ts / terminal runtime.ts 中重复的远程访问逻辑。
 * 统一使用 fetchWithTimeout（合并 terminal 的超时增强）。
 */

import { normalizeRelativeFilePath, normalizeRequestedExtensionPath, encodeRepoPathForUrl } from './paths.js';
import { MANIFEST_FILE, parseExtensionManifest } from './manifest.js';
import type { ExtensionManifestLike, RemoteIndexLike } from './types.js';

// ==================== 常量 ====================

export const DEFAULT_REMOTE_EXTENSION_INDEX_URL = 'https://raw.githubusercontent.com/Lianues/Iris/main/extensions/index.json';
export const DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL = 'https://raw.githubusercontent.com/Lianues/Iris/main';
export const DEFAULT_REMOTE_EXTENSIONS_SUBDIR = 'extensions';
export const DEFAULT_REMOTE_EXTENSION_REQUEST_TIMEOUT_MS = 15_000;

// ==================== 配置读取 ====================

export interface RemoteExtensionOptions {
  remoteIndexUrl?: string;
  remoteRawBaseUrl?: string;
  remoteExtensionsSubdir?: string;
}

export function getRemoteExtensionRequestTimeoutMs(): number {
  const raw = Number(process.env.IRIS_EXTENSION_REMOTE_TIMEOUT_MS?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMOTE_EXTENSION_REQUEST_TIMEOUT_MS;
}

export function getRemoteExtensionIndexUrl(options?: RemoteExtensionOptions): string {
  const configured = options?.remoteIndexUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_INDEX_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_INDEX_URL;
}

export function getRemoteRawBaseUrl(options?: RemoteExtensionOptions): string {
  const configured = options?.remoteRawBaseUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL;
}

export function getRemoteExtensionsSubdir(options?: RemoteExtensionOptions): string {
  const configured = options?.remoteExtensionsSubdir?.trim() || process.env.IRIS_EXTENSION_REMOTE_SUBDIR?.trim();
  return normalizeRelativeFilePath(configured || DEFAULT_REMOTE_EXTENSIONS_SUBDIR, '远程 extension 根目录');
}

// ==================== 网络请求 ====================

/**
 * 带超时保护的 fetch。
 * 默认 15s，可通过 IRIS_EXTENSION_REMOTE_TIMEOUT_MS 环境变量覆盖。
 */
export async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const timeoutMs = getRemoteExtensionRequestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `${label} 请求超时（${timeoutMs}ms）: ${url}`
      : `${label} 请求失败: ${error instanceof Error ? error.message : String(error)}: ${url}`;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/** 请求远程文件，返回 Buffer */
export async function fetchBuffer(url: string, label: string): Promise<Buffer> {
  const response = await fetchWithTimeout(url, label);
  if (!response.ok) {
    throw new Error(`${label} 下载失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** 请求远程 JSON */
export async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, label);
  if (!response.ok) {
    throw new Error(`${label} 读取失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return await response.json() as T;
}

// ==================== 远程仓库操作 ====================

/** 获取远程 extension 索引列表 */
export async function fetchRemoteIndex(options?: RemoteExtensionOptions): Promise<string[]> {
  const raw = await fetchJson<RemoteIndexLike>(getRemoteExtensionIndexUrl(options), '远程 extension 索引');
  if (!Array.isArray(raw.extensions)) {
    throw new Error('远程 extension 索引返回格式无效');
  }
  return raw.extensions.map((entry) => normalizeRequestedExtensionPath(String(entry), '远程 extension 路径'));
}

/** 拼接远程 extension 在仓库中的相对路径 */
export function buildRemoteExtensionPath(requested: string, options?: RemoteExtensionOptions): string {
  return `${getRemoteExtensionsSubdir(options)}/${requested}`;
}

/** 从 manifest.distribution.files 获取发行文件列表 */
export function getRemoteDistributionFiles(manifest: ExtensionManifestLike): string[] {
  return Array.isArray(manifest.distribution?.files)
    ? manifest.distribution.files.map((file) => normalizeRelativeFilePath(String(file), '远程 extension 文件路径'))
    : [];
}

/** 拼接单个远程 extension 文件的完整 URL */
export function buildRemoteExtensionFileUrl(requestedPath: string, relativePath: string, options?: RemoteExtensionOptions): string {
  const repoPath = `${buildRemoteExtensionPath(requestedPath, options)}/${relativePath}`;
  return `${getRemoteRawBaseUrl(options)}/${encodeRepoPathForUrl(repoPath)}`;
}

/** 获取远程 extension manifest */
export async function fetchRemoteManifest(requestedPath: string, options?: RemoteExtensionOptions): Promise<ExtensionManifestLike> {
  const manifestUrl = buildRemoteExtensionFileUrl(requestedPath, MANIFEST_FILE, options);
  const raw = await fetchJson<unknown>(manifestUrl, 'extension manifest');
  return parseExtensionManifest(raw, `${buildRemoteExtensionPath(requestedPath, options)}/${MANIFEST_FILE}`);
}
