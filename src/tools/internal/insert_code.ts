/**
 * 插入代码工具
 *
 * 在文件的指定行前插入代码。支持批量操作。
 * line = totalLines + 1 表示追加到末尾。
 */

import * as fs from 'fs';
import { ToolDefinition} from '../../types';
import { normalizeObjectArrayArg, resolveProjectPath } from '../utils';

interface InsertEntry {
  path: string;
  line: number;
  content: string;
}

interface InsertResult {
  path:string;
  success: boolean;
  line?: number;
  insertedLines?: number;
  error?: string;
}

function isInsertEntry(value: unknown): value is InsertEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && typeof (value as Record<string, unknown>).line === 'number'
    && typeof (value as Record<string, unknown>).content === 'string';
}

export const insertCode: ToolDefinition = {
  declaration: {
    name: 'insert_code',
    description: [
      '在一个或多个文件的指定行前插入代码。',
      '使用 line = 文件总行数 + 1 可追加到末尾。',
      '参数 files 必须是数组。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '插入操作列表',
          items: {
         type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于项目根目录）' },
              line: { type: 'number', description: '在此行前插入（1-based），使用 总行数+1 追加到末尾' },
              content: { type: 'string', description: '要插入的内容' },
            },
            required: ['path', 'line', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  handler: async (args) => {
    const fileList = normalizeObjectArrayArg(args, {
      arrayKey: 'files',
      singularKeys: ['file'],
      isEntry: isInsertEntry,
    });

    if(!fileList || fileList.length === 0) {
      throw new Error('files 参数必须是非空数组');
    }

    const results: InsertResult[] = [];
    let successCount = 0;
 let failCount = 0;

    for (const entry of fileList) {
      try {
        const resolved = resolveProjectPath(entry.path);
        const content = fs.readFileSync(resolved, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        if (entry.line < 1 || entry.line > totalLines + 1) {
          throw new Error(`行号 ${entry.line} 超出范围（1~${totalLines + 1}）`);
        }

        const insertLines = entry.content.split('\n');
        const idx = entry.line - 1;
        const newLines = [
          ...lines.slice(0, idx),
          ...insertLines,
          ...lines.slice(idx),
        ];

        fs.writeFileSync(resolved, newLines.join('\n'), 'utf-8');

        results.push({
          path: entry.path,
          success: true,
          line: entry.line,
          insertedLines: insertLines.length,
        });
        successCount++;
      } catch (err) {
        results.push({
          path: entry.path,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount++;
      }
    }

    return { results, successCount, failCount, totalCount: fileList.length };
  },
};
