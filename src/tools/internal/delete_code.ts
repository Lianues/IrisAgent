/**
 * 删除代码工具
 *
 * 删除文件中指定行范围的代码。支持批量操作。
 */

import * as fs from 'fs';
import { ToolDefinition } from '../../types';
import { normalizeObjectArrayArg, resolveProjectPath } from '../utils';

interface DeleteCodeEntry {
  path: string;
  start_line: number;
  end_line: number;
}

interface DeleteCodeResult {
  path: string;
  success: boolean;
  start_line?: number;
  end_line?: number;
  deletedLines?: number;
  error?: string;
}

function isDeleteCodeEntry(value: unknown): value is DeleteCodeEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && typeof (value as Record<string, unknown>).start_line === 'number'
    && typeof (value as Record<string, unknown>).end_line === 'number';
}

export const deleteCode: ToolDefinition = {
  declaration: {
    name: 'delete_code',
    description: [
      '删除一个或多个文件中指定行范围的代码（起止行均包含）。',
      '参数 files 必须是数组。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '删除操作列表',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于项目根目录）' },
              start_line: { type: 'number', description: '起始行号（1-based，含）' },
              end_line: { type: 'number', description: '结束行号（1-based，含）' },
            },
            required: ['path', 'start_line', 'end_line'],
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
      isEntry: isDeleteCodeEntry,
    });

    if (!fileList || fileList.length === 0) {
      throw new Error('files 参数必须是非空数组');
    }

    const results: DeleteCodeResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const entry of fileList) {
      try {
        const resolved = resolveProjectPath(entry.path);
        const content = fs.readFileSync(resolved, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        const { start_line, end_line } = entry;

        if (start_line < 1 || start_line > totalLines) {
          throw new Error(`start_line ${start_line} 超出范围（1~${totalLines}）`);
        }
        if (end_line < start_line || end_line > totalLines) {
          throw new Error(`end_line ${end_line} 超出范围（${start_line}~${totalLines}）`);
        }

        const newLines = [
          ...lines.slice(0, start_line - 1),
          ...lines.slice(end_line),
        ];

        fs.writeFileSync(resolved, newLines.join('\n'), 'utf-8');

        results.push({
          path: entry.path,
          success: true,
          start_line,
          end_line,
          deletedLines: end_line - start_line + 1,
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
