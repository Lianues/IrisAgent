/**
 * 文件系统工具
 *
 * 归集 core installer.ts / utils.ts / terminal runtime.ts 中重复的 FS 操作。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 判断路径是否为目录 */
export function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/** 递归创建目录（幂等） */
export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** 在 installedRootDir 下创建唯一临时安装目录 */
export function createTempInstallDir(installedRootDir: string): string {
  ensureDirectory(installedRootDir);
  const tempDir = path.join(
    installedRootDir,
    `.tmp-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/** 清理临时安装目录 */
export function cleanupTempInstallDir(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * 递归收集目录下所有文件的相对路径（POSIX 风格）。
 * 用于 distribution 分析和远程安装校验。
 */
export function collectRelativeFilesFromDir(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
    }
  }

  return files;
}
