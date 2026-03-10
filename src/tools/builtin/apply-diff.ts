/**
 * Diff 补丁工具
 *
 * 将 unified diff 格式的补丁应用到指定文件。
 * 支持多个 hunk，每个 hunk 先按行号定位，失败时全局搜索上下文。
 *
 * 补丁格式示例：
 *   @@ -7,3 +7,4 @@
 *    context line
 *   -old line
 *   +new line
 *    context line
 */

import * as fs from 'fs/promises';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

// ============ 类型 ============

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** 原始行（上下文 + 删除） */
  oldLines: string[];
  /** 新行（上下文 + 添加） */
  newLines: string[];
}

interface HunkResult {
  index: number;
  success: boolean;
  matchedLine?: number;
  error?: string;
}

// ============ 解析 ============

function parseHunks(patch: string): Hunk[] {
  const lines = patch.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 匹配 hunk 头
    const match = line.match(/^@@\s+-(?:(\d+)(?:,(\d+))?)\s+\+(?:(\d+)(?:,(\d+))?)\s*@@/);
    if (!match) {
      // 兼容裸 @@ （无行号）
      if (line.trim() === '@@') {
        i++;
        const oldLines: string[] = [];
        const newLines: string[] = [];
        while (i < lines.length && !lines[i].startsWith('@@')) {
          const l = lines[i];
          if (l.startsWith('-'))      { oldLines.push(l.slice(1)); }
          else if (l.startsWith('+')) { newLines.push(l.slice(1)); }
          else if (l.startsWith(' ')) { oldLines.push(l.slice(1)); newLines.push(l.slice(1)); }
          else if (l === '')          { oldLines.push(''); newLines.push(''); }  // 空行视为上下文
          i++;
        }
        hunks.push({ oldStart: 0, oldCount: oldLines.length, newStart: 0, newCount: newLines.length, oldLines, newLines });
        continue;
      }
      i++;
      continue;
    }

    const oldStart = parseInt(match[1], 10);
    const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

    i++;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (i < lines.length && !lines[i].startsWith('@@')) {
      const l = lines[i];
      if (l.startsWith('-'))      { oldLines.push(l.slice(1)); }
      else if (l.startsWith('+')) { newLines.push(l.slice(1)); }
      else if (l.startsWith(' ')) { oldLines.push(l.slice(1)); newLines.push(l.slice(1)); }
      else if (l === '')          { /* 跳过尾部空行 */ }
      else { break; }
      i++;
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, oldLines, newLines });
  }

  return hunks;
}

// ============ 应用 ============

/** 在 fileLines 中从 startIndex 开始匹配 oldLines */
function matchAt(fileLines: string[], startIndex: number, oldLines: string[]): boolean {
  if (startIndex < 0 || startIndex + oldLines.length > fileLines.length) return false;
  for (let i = 0; i < oldLines.length; i++) {
    if (fileLines[startIndex + i] !== oldLines[i]) return false;
  }
  return true;
}

/** 全局搜索 oldLines 在 fileLines 中的位置 */
function globalSearch(fileLines: string[], oldLines: string[]): number {
  if (oldLines.length === 0) return -1;
  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    if (matchAt(fileLines, i, oldLines)) return i;
  }
  return -1;
}

/**
 * 应用单个 hunk。
 * 先按行号定位，失败时全局搜索。
 * 返回应用后的文件行和匹配位置。
 */
function applyHunk(
  fileLines: string[],
  hunk: Hunk,
  offset: number,
): { lines: string[]; matchIndex: number; newOffset: number } | null {
  // 1. 按行号定位（hunk.oldStart 是 1-based）
  const lineIndex = hunk.oldStart > 0 ? hunk.oldStart - 1 + offset : -1;
if (lineIndex >= 0 && matchAt(fileLines, lineIndex, hunk.oldLines)) {
    const result = [
      ...fileLines.slice(0, lineIndex),
      ...hunk.newLines,
      ...fileLines.slice(lineIndex + hunk.oldLines.length),
    ];
    const newOffset = offset + (hunk.newLines.length - hunk.oldLines.length);
    return { lines: result, matchIndex: lineIndex, newOffset };
  }

  // 2. 全局搜索
  const found = globalSearch(fileLines, hunk.oldLines);
  if (found >= 0) {
    const result = [
      ...fileLines.slice(0, found),
      ...hunk.newLines,
      ...fileLines.slice(found + hunk.oldLines.length),
    ];
    const newOffset = offset + (hunk.newLines.length - hunk.oldLines.length);
    return { lines: result, matchIndex: found, newOffset };
  }

  return null;
}

// ============ 工具定义 ============

export const applyDiff: ToolDefinition = {
  declaration: {
    name: 'apply_diff',
    description: [
      '将 unified diff 补丁应用到指定文件。',
      '补丁格式：每个 hunk 以 @@ -oldStart,oldCount +newStart,newCount @@ 开头，',
      '后跟以空格开头的上下文行、以 - 开头的删除行、以 + 开头的添加行。',
      '可包含多个 hunk。每个 hunk 先按行号定位，失败时全局搜索上下文。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于项目根目录）',
        },
        patch: {
          type: 'string',
          description: [
            'Unified diff 补丁内容。',
            '每个 hunk 以 @@ -oldStart,oldCount +newStart,newCount @@ 开头。',
            '行前缀：空格=上下文，-=删除，+=添加。',
            '不需要 ---/+++ 文件头。',
          ].join(''),
        },
      },
      required: ['path', 'patch'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const patch = args.patch as string;

    // 安全检查
    const resolved = resolveProjectPath(filePath);

    // 读取文件
    const content = await fs.readFile(resolved, 'utf-8');
    let fileLines = content.split('\n');

    // 解析 hunk
    const hunks = parseHunks(patch);
    if (hunks.length === 0) {
      throw new Error('补丁中未找到有效的 hunk');
    }

    // 逐个应用
    const results: HunkResult[] = [];
    let offset = 0;
    let appliedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < hunks.length; i++) {
      const hunk = hunks[i];
      const applied = applyHunk(fileLines, hunk, offset);

      if (applied) {
        fileLines = applied.lines;
        offset = applied.newOffset;
        appliedCount++;
        results.push({ index: i, success: true, matchedLine: applied.matchIndex + 1 });
      } else {
        failedCount++;
        results.push({
          index: i,
          success: false,
          error: `无法定位上下文（oldStart=${hunk.oldStart}，待匹配 ${hunk.oldLines.length} 行）`,
        });
      }
    }

    // 只要有成功的 hunk 就写入文件
    if (appliedCount > 0) {
      await fs.writeFile(resolved, fileLines.join('\n'), 'utf-8');
    }

    return {
      path: filePath,
      totalHunks: hunks.length,
      applied: appliedCount,
      failed: failedCount,
      results,
    };
  },
};
