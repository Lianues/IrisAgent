/**
 * 工具层公共工具函数
 */

import * as path from 'path';

export interface NormalizeObjectArrayArgOptions<T> {
  arrayKey: string;
  singularKeys?: string[];
  isEntry: (value: unknown) => value is T;
}

export interface NormalizeStringArrayArgOptions {
  arrayKey: string;
  singularKeys?: string[];
}

export function normalizeObjectArrayArg<T>(
  args: Record<string, unknown>,
  options: NormalizeObjectArrayArgOptions<T>,
): T[] | undefined {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    const normalized = arrayValue.filter(options.isEntry);
    return normalized.length === arrayValue.length ? normalized : undefined;
  }

  if (options.isEntry(arrayValue)) {
    return [arrayValue];
  }

  for (const key of options.singularKeys ?? []) {
    const singularValue = args[key];
    if (options.isEntry(singularValue)) {
      return [singularValue];
    }
  }

  if (options.isEntry(args)) {
    return [args];
  }

  return undefined;
}

export function normalizeStringArrayArg(
  args: Record<string, unknown>,
  options: NormalizeStringArrayArgOptions,
): string[] | undefined {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    return arrayValue.every((item) => typeof item === 'string' && item.trim().length > 0)
      ? arrayValue as string[]
      : undefined;
  }

  for (const value of [arrayValue, ...(options.singularKeys ?? []).map((key) => args[key])]) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value];
    }
  }

  return undefined;
}

/**
 * 解析路径并校验是否在项目目录内，防止路径穿越。
 * 返回解析后的绝对路径。
 */
export function resolveProjectPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const cwd = process.cwd();
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`路径超出项目目录: ${inputPath}`);
  }
  return resolved;
}
