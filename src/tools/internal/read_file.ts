/**
 * 读取文件工具
 *
 * 支持批量读取，每个文件可单独指定行范围。
 * 返回带行号的格式化文本。仅支持文本类型文件。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

/** 支持的文本文件扩展名 */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.json5',
  '.html', '.htm', '.css', '.scss', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
 '.xml', '.svg',
  '.csv', '.tsv', '.log',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.sql', '.vue', '.svelte', '.astro',
  '',
]);

/** 无扩展名但是文本的已知文件名 */
const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  'LICENSE', 'CHANGELOG', 'README',
  '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const basename = path.basename(filePath);
  if (basename.startsWith('.env')) return true;
  return TEXT_FILENAMES.has(basename);
}

function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const totalLines = startLine + lines.length - 1;
  const width = String(totalLines).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`)
    .join('\n');
}

interface FileReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

interface ReadResult {
  path: string;
  success: boolean;
  type?: 'text';
  content?:string;
  lineCount?: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  error?: string;
}

export const readFile: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'read_file',
    description: [
      '读取一个或多个文本文件的内容。',
      '返回带行号的格式化文本。',
      '每个文件可单独指定 startLine 和 endLine（行号从 1 开始）。',
      '参数 files 必须是数组，即使只读一个文件。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '文件列表，每项包含 path（必填）、startLine（可选）、endLine（可选）',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于项目根目录）' },
              startLine: { type: 'number', description: '起始行号（1-based，含）' },
              endLine: { type: 'number', description: '结束行号（1-based，含）' },
            },
            required: ['path'],
          },
        },
      },
      required: ['files'],
    },
  },
  handler: async (args) => {
    const fileList = args.files as FileReadRequest[] | undefined;
    if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
      throw new Error('files 参数必须是非空数组');
    }

    const results: ReadResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const fileReq of fileList) {
      try {
        const resolved = resolveProjectPath(fileReq.path);

        if (!isTextFile(fileReq.path)) {
          throw new Error(`不支持的文件类型: ${path.extname(fileReq.path) || '(无扩展名)'}`);
        }

        const raw = await fs.readFile(resolved, 'utf-8');
        const allLines = raw.split('\n');
        const totalLines = allLines.length;

        const startLine = Math.max(1, fileReq.startLine ?? 1);
        const endLine = fileReq.endLine ? Math.min(fileReq.endLine, totalLines) : totalLines;

        if (startLine > totalLines) {
          throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
        }

        const sliced = allLines.slice(startLine - 1, endLine);
        const formatted = formatWithLineNumbers(sliced.join('\n'), startLine);

        const result: ReadResult = {
          path: fileReq.path,
          success: true,
          type: 'text',
          content: formatted,
          lineCount: sliced.length,
        };

        // 如果指定了行范围，附加额外信息
        if (fileReq.startLine !== undefined || fileReq.endLine !== undefined) {
          result.totalLines = totalLines;
          result.startLine = startLine;
          result.endLine = endLine;
        }

        results.push(result);
        successCount++;
      } catch (err) {
        results.push({
          path: fileReq.path,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount++;
      }
    }

    return { results, successCount, failCount, totalCount: fileList.length };
  },
};
