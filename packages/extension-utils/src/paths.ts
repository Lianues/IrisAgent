/**
 * 路径处理工具
 *
 * 归集 core installer.ts / utils.ts / terminal runtime.ts 中重复的路径函数。
 */

import * as path from 'node:path';

/** 安全修剪文本：空白或非字符串返回 undefined */
export function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * 将任意路径输入规范为 POSIX 风格的相对路径（不以 / 开头或结尾，不含 . 或 .. 段）。
 * 不合法时抛异常。
 */
export function normalizeRelativeFilePath(input: string, label = '文件路径'): string {
  const normalized = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) {
    throw new Error(`${label}不能为空`);
  }

  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label}无效: ${input}`);
  }

  return parts.join('/');
}

/**
 * 将用户请求的 extension 路径规范化：
 * - 去除 `./` 前缀
 * - 去除 `extensions/` 前缀
 * - 调用 normalizeRelativeFilePath 做最终校验
 */
export function normalizeRequestedExtensionPath(requested: string, label: string): string {
  const trimmed = requested.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空`);
  }

  let normalized = trimmed.replace(/\\/g, '/').trim();
  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');

  if (normalized === 'extensions' || normalized === 'extensions/') {
    throw new Error(`${label}不能为空`);
  }

  if (normalized.startsWith('extensions/')) {
    normalized = normalized.slice('extensions/'.length);
  }

  return normalizeRelativeFilePath(normalized, label);
}

/**
 * 在 rootDir 下安全解析相对路径，防止路径遍历攻击（.. 越界）。
 */
export function resolveSafeRelativePath(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);
  const rel = path.relative(normalizedRoot, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界: ${relativePath}`);
  }
  return resolvedPath;
}

/** 对 URL 中的 repo 路径段做 encodeURIComponent */
export function encodeRepoPathForUrl(repoPath: string): string {
  return repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
}
