/**
 * 工具层公共工具函数
 */

import * as path from 'path';

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
