/**
 * 搜索替换工具
 *
 * 在指定文件中搜索内容，可选替换。
 * 支持普通字符串和正则表达式。
 */

import * as fs from 'fs/promises';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

export const searchReplace: ToolDefinition = {
  declaration: {
    name: 'search_replace',
    description: [
      '在指定文件中搜索内容。',
      '提供 replace 参数时执行替换，否则仅搜索。',
      '支持正则表达式（设 isRegex=true）。',
      '搜索结果返回匹配行及其行号。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于项目根目录）',
        },
        search: {
          type: 'string',
          description: '搜索内容（字符串或正则表达式）',
        },
        replace: {
          type: 'string',
          description: '替换内容（省略则仅搜索，正则模式下支持 $1 $2 等捕获组）',
        },
        isRegex: {
          type: 'boolean',
          description: '是否将 search 作为正则表达式，默认 false',
        },
      },
      required: ['path', 'search'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const search = args.search as string;
    const replace = args.replace as string | undefined;
    const isRegex = (args.isRegex as boolean) ?? false;

    // 安全检查
    const resolved = resolveProjectPath(filePath);

    const content = await fs.readFile(resolved, 'utf-8');
    const lines = content.split('\n');

    // 构建正则
    const regex = isRegex
      ? new RegExp(search, 'g')
      : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

    // 搜索模式
    if (replace === undefined) {
      const matches: { line: number; content: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ line: i + 1, content: lines[i] });
        }
        regex.lastIndex = 0; // 重置正则状态
      }
      return {
        path: filePath,
        mode: 'search',
        matchCount: matches.length,
        matches,
      };
    }

    // 替换模式
    const newContent = content.replace(regex, replace);
    const changed = newContent !== content;

    if (changed) {
      await fs.writeFile(resolved, newContent, 'utf-8');
    }

    // 统计替换次数
    const matchCount = (content.match(regex) ?? []).length;

    return {
      path: filePath,
      mode: 'replace',
      matchCount,
      replaced: changed,
    };
  },
};
