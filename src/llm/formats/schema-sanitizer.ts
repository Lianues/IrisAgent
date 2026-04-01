/**
 * 工具 Schema 降级处理
 *
 * MCP 工具返回的 inputSchema 是完整的 JSON Schema，
 * 但各 LLM provider 对 function calling 的 schema 支持程度不同。
 *
 * 此模块提供按 provider 降级的函数，在保留尽可能多信息的前提下，
 * 确保 schema 能被对应 provider 接受。
 *
 * 已知限制（基于 2026-03 实测 + 社区 issue 调研）：
 *
 *   Gemini:
 *     - enum 值必须是字符串（数字 enum 报 TYPE_STRING 错误）
 *     - 不支持 additionalProperties（function declaration 中）
 *     - anyOf 不能与其他字段混用（必须是属性中的唯一字段）
 *     - 不支持 $ref（已由 dereference 层处理）
 *     - 不支持 title、default、const、not、if/then/else
 *     - 嵌套深度有限制（未文档化）
 *     - schema 复杂度有隐式上限（"too many states"）
 *
 *   OpenAI (non-strict):
 *     - 宽松模式下基本接受完整 JSON Schema
 *     - enum 数字值不会报错但模型可能理解不准，统一转字符串更稳定
 *
 *   Claude:
 *     - 不支持顶层 oneOf/allOf/anyOf（嵌套内可以）
 *     - 其余基本完整支持
 */

// ===================== Gemini =====================

/**
 * 为 Gemini 降级 schema。最严格的处理：
 *   1. enum 数字值 → 字符串
 *   2. 删除 additionalProperties
 *   3. anyOf/oneOf/allOf → 尝试展平或取第一个分支
 *   4. 删除 title、default、const、$defs、definitions、$schema
 *   5. 递归处理所有嵌套
 */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForGemini);
  }

  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  let hasStringifiedEnum = false;

  for (const [key, value] of Object.entries(obj)) {
    // 删除 Gemini 不支持的关键字
    // $schema: MCP 工具的 inputSchema 常携带此字段，Gemini API 不识别会直接 400
    if (['title', 'default', 'const', '$defs', 'definitions', '$schema',
         'not', 'if', 'then', 'else', 'prefixItems'].includes(key)) {
      continue;
    }

    // 删除 additionalProperties
    if (key === 'additionalProperties') {
      continue;
    }

    // anyOf/oneOf/allOf: 尝试展平或取第一个
    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      // 如果是属性层级的 anyOf（与 type/properties 等混用），跳过 anyOf
      // 如果是唯一字段，取第一个分支展开
      const otherKeys = Object.keys(obj).filter(k =>
        k !== key && !['title', 'default', 'const', '$defs', 'definitions',
          'not', 'if', 'then', 'else', 'prefixItems', 'additionalProperties'].includes(k)
      );
      if (otherKeys.length === 0 && value.length > 0) {
        // anyOf 是唯一有意义的字段 → 取第一个分支展开
        const first = sanitizeSchemaForGemini(value[0]);
        if (first && typeof first === 'object') {
          Object.assign(result, first);
        }
        continue;
      }
      // 与其他字段混用 → 直接丢弃 anyOf
      continue;
    }

    // enum: 所有值转为字符串
    if (key === 'enum' && Array.isArray(value)) {
      result[key] = value.map(v => String(v));
      hasStringifiedEnum = true;
      continue;
    }

    // 递归处理嵌套对象
    result[key] = sanitizeSchemaForGemini(value);
  }

  // enum 值已转为字符串，type 需要同步改为 string
  // 放在循环结束后处理，避免被后续的 type 字段赋值覆盖
  if (hasStringifiedEnum && (result.type === 'integer' || result.type === 'number')) {
    result.type = 'string';
  }

  return result;
}

// ===================== OpenAI =====================

/**
 * 为 OpenAI (non-strict) 降级 schema。轻量处理：
 *   1. enum 数字值 → 字符串（提高模型理解准确度）
 *   2. 删除 $defs/definitions（已由 dereference 层处理）
 *   3. 其余保留
 */
export function sanitizeSchemaForOpenAI(schema: unknown): unknown {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForOpenAI);
  }

  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // 删除已展开的残留
    // $schema: MCP 工具常携带，对 LLM API 无意义
    if (key === '$defs' || key === 'definitions' || key === '$schema') continue;

    // enum: 统一转字符串
    if (key === 'enum' && Array.isArray(value)) {
      result[key] = value.map(v => String(v));
      continue;
    }

    result[key] = sanitizeSchemaForOpenAI(value);
  }

  return result;
}

// ===================== Claude =====================

/**
 * 为 Claude 降级 schema。中等处理：
 *   1. 顶层 oneOf/allOf/anyOf → 取第一个分支（嵌套内保留）
 *   2. 删除 $defs/definitions
 *   3. enum 数字值 → 字符串
 */
export function sanitizeSchemaForClaude(schema: unknown, isTopLevel = true): unknown {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(v => sanitizeSchemaForClaude(v, false));
  }

  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // 删除已展开的残留
    // $schema: MCP 工具常携带，对 LLM API 无意义
    if (key === '$defs' || key === 'definitions' || key === '$schema') continue;

    // 顶层的 anyOf/oneOf/allOf → 取第一个分支
    if (isTopLevel && (key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value) && value.length > 0) {
      const first = sanitizeSchemaForClaude(value[0], false);
      if (first && typeof first === 'object') {
        Object.assign(result, first);
      }
      continue;
    }

    // enum: 统一转字符串
    if (key === 'enum' && Array.isArray(value)) {
      result[key] = value.map(v => String(v));
      continue;
    }

    result[key] = sanitizeSchemaForClaude(value, false);
  }

  return result;
}
