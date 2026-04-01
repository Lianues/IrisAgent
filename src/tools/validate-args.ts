/**
 * 工具参数 JSON Schema 校验
 *
 * 将 JSON Schema 校验错误转为模型可理解的自然语言描述，
 * 作为工具调用的错误结果返回给模型，让模型自行修正参数后重试。
 *
 * 为什么需要：
 *   - 没有此校验时，参数错误会在工具 handler 内部抛出程序异常，
 *     错误信息是堆栈跟踪，模型无法理解
 *   - 有了此校验，模型能看到 "The required parameter `files` is missing" 这样的描述
 *
 * 校验范围（仅顶层参数，不递归）：
 *   1. 必需字段是否存在（required 中列出但未提供）
 *   2. 已有字段的类型是否匹配（schema 定义为 number 但收到 string 等）
 *   3. 是否有 schema 中未定义的多余字段
 *
 */

import type { ToolParameterSchema } from './coerce-args';

/**
 * 校验工具参数是否符合 JSON Schema。
 *
 * @param toolName 工具名称（用于错误消息）
 * @param args     工具参数（应已经过 coerceToolArgs 处理）
 * @param schema   工具的 JSON Schema 参数定义
 * @returns 校验通过返回 null，否则返回模型可理解的错误描述
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  schema: ToolParameterSchema | undefined,
): string | null {
  if (!schema?.properties) {
    return null;
  }

  const issues: string[] = [];

  // 1. 检查必需字段是否存在
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in args) || args[key] === undefined) {
        issues.push(`The required parameter \`${key}\` is missing`);
      }
    }
  }

  // 2. 检查已有字段的类型是否匹配
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in args) || args[key] === undefined || args[key] === null) {
      continue;
    }

    const value = args[key];
    const expectedType = (propSchema as Record<string, unknown>)?.type as string | undefined;

    if (!expectedType) {
      continue;
    }

    const actualType = getJsonType(value);

    // integer 是 number 的子类型，单独处理
    if (expectedType === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issues.push(
          `The parameter \`${key}\` type is expected as \`integer\` but provided as \`${actualType}\``
        );
      }
      continue;
    }

    if (!typesMatch(expectedType, actualType)) {
      issues.push(
        `The parameter \`${key}\` type is expected as \`${expectedType}\` but provided as \`${actualType}\``
      );
    }
  }

  // 3. 检查多余字段
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) {
      issues.push(`An unexpected parameter \`${key}\` was provided`);
    }
  }

  if (issues.length === 0) {
    return null;
  }

  // 格式化为模型可理解的错误描述
  const noun = issues.length > 1 ? 'issues' : 'issue';
  return `${toolName} failed due to the following ${noun}:\n${issues.join('\n')}`;
}

/**
 * 获取值的 JSON Schema 类型名称。
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

/**
 * 检查实际类型是否与期望类型匹配。
 */
function typesMatch(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  // number schema 也接受 JS 的 number 类型（包括整数）
  if (expected === 'number' && actual === 'number') return true;
  return false;
}
