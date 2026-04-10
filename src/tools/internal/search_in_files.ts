/**
 * 在文件中搜索（和替换）内容工具
 *
 * 目标：提供一个不依赖 VSCode API 的 search_in_files 工具，
 * 适配 Iris 当前的 Node.js 运行环境。
 *
 * 能力范围：
 * - 在目录或单文件中搜索
 * - 支持 glob 形式的文件匹配（基础通配：*、?、**）
 * - 支持正则表达式搜索与替换
 * - 支持限制最大结果数与最大处理文件数
 * - 自动跳过疑似二进制文件与过大文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';
import { getToolLimits } from '../tool-limits';
import {
  toPosix, globToRegExp, isLikelyBinary, decodeText, buildSearchRegex, walkFiles,
  type TextEncoding,
} from 'irises-extension-sdk/tool-utils';

export { toPosix, globToRegExp, isLikelyBinary, decodeText, buildSearchRegex, walkFiles, DEFAULT_IGNORED_DIRS } from 'irises-extension-sdk/tool-utils';
export type { TextEncoding, DetectedText } from 'irises-extension-sdk/tool-utils';

const DEFAULT_PATTERN = '**/*';

interface SearchMatch {
  file: string;
  line: number;
  column: number;
  match: string;
  context: string;
}

interface ReplaceFileResult {
  file: string;
  replacements: number;
  changed: boolean;
  skipped?: boolean;
  reason?: string;
}

type ToolMode = 'search' | 'replace';

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  if (!isNonNegativeInteger(value)) return fallback;
  return value === 0 ? fallback : value;
}

function swapByteOrder16(buf: Buffer): Buffer {
  const len = buf.length - (buf.length % 2);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

function encodeText(text: string, encoding: TextEncoding, hasBom: boolean, preferCRLF: boolean): Buffer {
  const normalized = preferCRLF ? text.replace(/\r?\n/g, '\r\n') : text;

  if (encoding === 'utf-16le') {
    const body = Buffer.from(normalized, 'utf16le');
    return hasBom ? Buffer.concat([Buffer.from([0xFF, 0xFE]), body]) : body;
  }

  if (encoding === 'utf-16be') {
    const bodyLE = Buffer.from(normalized, 'utf16le');
    const bodyBE = swapByteOrder16(bodyLE);
    return hasBom ? Buffer.concat([Buffer.from([0xFE, 0xFF]), bodyBE]) : bodyBE;
  }

  // utf-8
  const body = Buffer.from(normalized, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]) : body;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function findLineIndex(lineStarts: number[], offset: number): number {
  // 返回 lineStarts 中最后一个 <= offset 的索引
  let lo = 0;
  let hi = lineStarts.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = lineStarts[mid];
    if (start === offset) return mid;
    if (start < offset) lo = mid + 1;
    else hi = mid - 1;
  }

  return Math.max(0, lo - 1);
}

function truncateLine(line: string, max: number): string {
  if (line.length <= max) return line;
  // 保留前部 + 尾部少量，中间标记截断
  const head = Math.floor(max * 0.75);
  const tail = Math.floor(max * 0.15);
  return line.slice(0, head) + ` ... [${line.length} chars] ... ` + line.slice(-tail);
}

function buildContext(lines: string[], lineNumber1Based: number, contextLines: number, maxLineChars: number): string {
  const total = lines.length;
  const start = Math.max(1, lineNumber1Based - contextLines);
  const end = Math.min(total, lineNumber1Based + contextLines);

  const out: string[] = [];
  for (let ln = start; ln <= end; ln++) {
    out.push(`${ln}: ${truncateLine(lines[ln - 1] ?? '', maxLineChars)}`);
  }
  return out.join('\n');
}

export const searchInFiles: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'search_in_files',
    description: [
      '在一个文件或目录中搜索内容，可选执行替换。',
      '支持基础 glob 匹配（*、?、**）与正则表达式（isRegex=true）。',
      '默认忽略 .git、node_modules、dist 等目录。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '操作模式：search（默认）或 replace',
          enum: ['search', 'replace'],
        },
        query: {
          type: 'string',
          description: '搜索关键词或正则表达式',
        },
        path: {
          type: 'string',
          description: '搜索路径（相对于项目根目录），可以是目录或单个文件，默认 "."',
        },
        pattern: {
          type: 'string',
          description: '文件匹配 glob（默认 "**/*"）。当 path 为文件时忽略此参数。',
        },
        isRegex: {
          type: 'boolean',
          description: '是否将 query 视为正则表达式，默认 false',
        },
        maxResults: {
          type: 'number',
          description: '最大匹配结果数（默认 100，search 模式生效）',
        },
        replace: {
          type: 'string',
          description: '替换字符串（仅 replace 模式使用，正则支持 $1 $2 等捕获组）',
        },
        maxFiles: {
          type: 'number',
          description: '最大处理文件数（默认 50，replace 模式生效）',
        },
        contextLines: {
          type: 'number',
          description: '每条匹配返回的上下文行数（默认 2）',
        },
        maxFileSizeBytes: {
          type: 'number',
          description: '单文件最大读取字节数（默认 2097152 = 2MB）',
        },
      },
      required: ['query'],
    },
  },
  handler: async (args) => {
    const limits = getToolLimits().search_in_files;

    const mode = ((args.mode as ToolMode | undefined) ?? 'search');
    const query = String(args.query ?? '');

    const inputPath = (args.path as string | undefined) ?? '.';
    const pattern = (args.pattern as string | undefined) ?? DEFAULT_PATTERN;
    const isRegex = (args.isRegex as boolean | undefined) ?? false;
    // LLM 传入的值不得超过配置上限
    const maxResults = Math.min(clampPositiveInteger(args.maxResults, limits.maxResults), limits.maxResults);
    const maxFiles = Math.min(clampPositiveInteger(args.maxFiles, limits.maxFiles), limits.maxFiles);
    const contextLines = Math.min(clampPositiveInteger(args.contextLines, limits.contextLines), limits.contextLines);
    const maxFileSizeBytes = Math.min(clampPositiveInteger(args.maxFileSizeBytes, limits.maxFileSizeBytes), limits.maxFileSizeBytes);

    if (mode !== 'search' && mode !== 'replace') {
      throw new Error(`mode 参数无效: ${String(args.mode)}`);
    }

    const rootAbs = resolveProjectPath(inputPath);
    const stat = fs.statSync(rootAbs);

    if (mode === 'search') {
      const regex = buildSearchRegex(query, isRegex);
      const patternRe = globToRegExp(pattern);

      const results: SearchMatch[] = [];
      let filesSearched = 0;
      let skippedBinary = 0;
      let skippedTooLarge = 0;
      let truncated = false;

      const shouldStop = () => results.length >= maxResults;

      const processFile = (fileAbs: string, relPosix: string) => {
        if (shouldStop()) return;

        // 目录模式下做 pattern 过滤
        if (stat.isDirectory() && !patternRe.test(relPosix)) return;

        filesSearched++;
        const buf = fs.readFileSync(fileAbs);

        if (buf.length > maxFileSizeBytes) {
          skippedTooLarge++;
          return;
        }

        if (isLikelyBinary(buf)) {
          skippedBinary++;
          return;
        }

        const decoded = decodeText(buf);
        // 为了稳定展示上下文，统一为 LF
        const textLF = decoded.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const localRegex = new RegExp(regex.source, regex.flags);
        const lineStarts = computeLineStarts(textLF);
        const lines = textLF.split('\n');

        for (;;) {
          const m = localRegex.exec(textLF);
          if (!m) break;

          // 防止零长度匹配导致死循环
          if (m[0].length === 0) {
            localRegex.lastIndex++;
            continue;
          }

          const offset = m.index ?? 0;
          const lineIndex0Based = findLineIndex(lineStarts, offset);
          const lineNumber = lineIndex0Based + 1;
          const lineStartOffset = lineStarts[lineIndex0Based] ?? 0;
          const column = offset - lineStartOffset + 1;

          results.push({
            file: stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath),
            line: lineNumber,
            column,
            match: truncateLine(m[0], limits.maxMatchDisplayChars),
            context: buildContext(lines, lineNumber, contextLines, limits.maxLineDisplayChars),
          });

          if (shouldStop()) {
            truncated = true;
            break;
          }
        }
      };

      if (stat.isFile()) {
        processFile(rootAbs, toPosix(path.basename(rootAbs)));
      } else {
        walkFiles(rootAbs, processFile, shouldStop);
      }

      if (results.length >= maxResults) truncated = true;

      return {
        mode,
        query,
        isRegex,
        path: inputPath,
        pattern,
        results,
        count: results.length,
        truncated,
        filesSearched,
        skippedBinary,
        skippedTooLarge,
      };
    }

    // replace 模式
    const replace = args.replace;
    if (typeof replace !== 'string') {
      throw new Error('replace 模式下必须提供 replace 参数');
    }

    const regex = buildSearchRegex(query, isRegex);
    const patternRe = globToRegExp(pattern);

    const results: ReplaceFileResult[] = [];
    let processedFiles = 0;
    let totalReplacements = 0;
    let truncated = false;

    const shouldStop = () => processedFiles >= maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      if (shouldStop()) return;

      // 目录模式下做 pattern 过滤
      if (stat.isDirectory() && !patternRe.test(relPosix)) return;

      processedFiles++;

      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes) {
        results.push({
          file: stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath),
          replacements: 0,
          changed: false,
          skipped: true,
          reason: `file too large (> ${maxFileSizeBytes} bytes)`,
        });
        return;
      }

      if (isLikelyBinary(buf)) {
        results.push({
          file: stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath),
          replacements: 0,
          changed: false,
          skipped: true,
          reason: 'binary file',
        });
        return;
      }

      const decoded = decodeText(buf);
      const localRegex = new RegExp(regex.source, regex.flags);

      let replacements = 0;
      for (;;) {
        const m = localRegex.exec(decoded.text);
        if (!m) break;
        if (m[0].length === 0) {
          localRegex.lastIndex++;
          continue;
        }
        replacements++;
      }

      if (replacements === 0) {
        results.push({
          file: stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath),
          replacements: 0,
          changed: false,
        });
        return;
      }

      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      const changed = newText !== decoded.text;

      if (changed) {
        const out = encodeText(newText, decoded.encoding, decoded.hasBom, decoded.hasCRLF);
        fs.writeFileSync(fileAbs, out);
      }

      results.push({
        file: stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath),
        replacements,
        changed,
      });

      totalReplacements += replacements;
    };

    if (stat.isFile()) {
      processFile(rootAbs, toPosix(path.basename(rootAbs)));
    } else {
      walkFiles(rootAbs, processFile, shouldStop);
      if (processedFiles >= maxFiles) truncated = true;
    }

    return {
      mode,
      query,
      replace,
      isRegex,
      path: inputPath,
      pattern,
      results,
      processedFiles,
      totalReplacements,
      truncated,
    };
  },
};
