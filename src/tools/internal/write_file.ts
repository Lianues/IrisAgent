/**
 * 写入文件工具
 *
 * 支持批量写入。新文件自动创建父目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

interface WriteEntry {
  path: string;
  content: string;
}

interface WriteResult {
  path: string;
  success: boolean;
  action?: 'created' | 'modified' | 'unchanged';
  error?: string;
}

export const writeFile: ToolDefinition = {
  declaration: {
    name: 'write_file',
    description: [
      '写入一个或多个文件。',
      '文件不存在时自动创建（含父目录）。',
      '内容与现有内容相同时返回 unchanged。',
      '参数files 必须是数组，即使只写一个文件。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '文件列表，每项包含 path 和 content',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于项目根目录）' },
              content: { type: 'string', description: '要写入的内容' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  handler: async (args) => {
    const fileList = args.files as WriteEntry[] | undefined;
    if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
      throw new Error('files 参数必须是非空数组');
    }

    const results: WriteResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const entry of fileList) {
      try {
        const resolved = resolveProjectPath(entry.path);
        const dir = path.dirname(resolved);

        // 检查是否已存在
        let fileExists = false;
        let originalContent = '';
        try {
          originalContent = fs.readFileSync(resolved, 'utf-8');
          fileExists = true;
        } catch {
          fileExists = false;
        }

        // 内容相同
        if (fileExists && originalContent === entry.content) {
          results.push({ path: entry.path, success: true, action: 'unchanged' });
          successCount++;
          continue;
        }

        // 创建目录
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 写入
        fs.writeFileSync(resolved, entry.content, 'utf-8');
        results.push({
          path: entry.path,
          success: true,
          action: fileExists ? 'modified' : 'created',
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
