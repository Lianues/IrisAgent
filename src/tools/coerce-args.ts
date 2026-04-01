/**
 * 工具参数类型容错转换
 *
 * 在工具 handler 调用之前，对顶层参数做静默类型转换，
 * 修正模型高频输出错误：
 *   - boolean："true" → true，"false" → false
 *   - number/integer："60000" → 60000，"-5" → -5，"3.14" → 3.14
 *   - array：JSON 字符串 → 数组（仅当 JSON.parse 结果是数组时替换）
 *
 * 设计原则：
 *   - 只处理顶层参数（schema.properties 中声明的），不做递归
 *   - 未修改时返回原始对象引用（避免不必要的浅拷贝）
 *   - 仅处理精确匹配的转换（不猜测，不做模糊匹配）
 *
 */

import type { FunctionDeclaration } from '../types';

/** 工具参数 schema 类型（从 FunctionDeclaration.parameters 提取） */
export type ToolParameterSchema = FunctionDeclaration['parameters'];

/**
 * 对顶层参数做类型容错转换。
 *
 * 为什么需要：模型（尤其是较小的模型）经常在 JSON 输出中给布尔值和数字加引号，
 * 比如输出 {"recursive": "true"} 而非 {"recursive": true}。
 * 不做容错的话，工具内部要么静默得到错误类型，要么直接报错。
 *
 * @param args   模型输出的工具参数
 * @param schema 工具的 JSON Schema 参数定义
 * @returns 修正后的参数（未修改时返回原引用）
 */
export function coerceToolArgs(
  args: Record<string, unknown>,
  schema: ToolParameterSchema | undefined,
): Record<string, unknown> {
  if (args == null || typeof args !== 'object' || !schema?.properties) {
    return args;
  }

  const result: Record<string, unknown> = { ...args };
  let modified = false;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in result)) {
      continue;
    }

    const rawValue = result[key];
    const schemaType = (propSchema as Record<string, unknown>)?.type as string | undefined;

    // boolean 容错："true" → true, "false" → false
    // 仅处理精确的 "true"/"false" 字符串，不转换 "yes"、"1" 等
    if (schemaType === 'boolean' && typeof rawValue === 'string') {
      if (rawValue === 'true') {
        result[key] = true;
        modified = true;
      } else if (rawValue === 'false') {
        result[key] = false;
        modified = true;
      }
      continue;
    }

    // number / integer 容错："30" → 30, "-5" → -5, "3.14" → 3.14
    // 仅处理合法十进制数字字符串
    if ((schemaType === 'number' || schemaType === 'integer') && typeof rawValue === 'string') {
      if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
        const n = Number(rawValue);
        if (Number.isFinite(n)) {
          result[key] = n;
          modified = true;
        }
      }
      continue;
    }

    // array 容错：JSON 字符串 → 数组（仅当解析结果本身是数组时替换）
    // 不做双层解析：如果 JSON.parse 出来不是数组，保持原值
    if (schemaType === 'array' && typeof rawValue === 'string' && !Array.isArray(rawValue)) {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
          result[key] = parsed;
          modified = true;
        }
      } catch {
        // JSON 解析失败，保持原值，后续由 validateToolArgs 报错
      }
      continue;
    }
  }

  // 未修改时返回原始对象引用，避免不必要的浅拷贝
  return modified ? result : args;
}

/**
 * 校验 array 参数是否已经是数组。
 *
 * 在 coerceToolArgs 做完字符串→数组尝试后，
 * 如果对应参数仍然不是数组，返回格式化的错误描述。
 *
 * @param toolName 工具名称（用于错误消息）
 * @param args     工具参数（已经过 coerceToolArgs 处理）
 * @param schema   工具的 JSON Schema 参数定义
 * @returns 错误描述或 null
 */
export function getToolArgsArrayValidationError(
  toolName: string,
  args: Record<string, unknown>,
  schema: ToolParameterSchema | undefined,
): string | null {
  if (args == null || typeof args !== 'object' || !schema?.properties) {
    return null;
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const schemaType = (propSchema as Record<string, unknown>)?.type as string | undefined;
    if (!(key in args) || schemaType !== 'array') {
      continue;
    }

    const value = args[key];
    if (Array.isArray(value)) {
      continue;
    }

    if (typeof value === 'string') {
      return `Tool "${toolName}" expects parameter "${key}" to be an array. The model returned a string, but it could not be parsed into a JSON array.`;
    }

    return `Tool "${toolName}" expects parameter "${key}" to be an array.`;
  }

  return null;
}
