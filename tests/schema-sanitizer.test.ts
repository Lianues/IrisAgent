/**
 * schema-sanitizer 单元测试
 *
 * 验证三个 provider 的 schema 降级函数：
 *   - sanitizeSchemaForGemini:  最严格，删除 additionalProperties/title/default/const 等
 *   - sanitizeSchemaForOpenAI:  轻量，仅处理 enum 和 $defs
 *   - sanitizeSchemaForClaude:  中等，处理顶层 anyOf/oneOf/allOf
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeSchemaForGemini,
  sanitizeSchemaForOpenAI,
  sanitizeSchemaForClaude,
} from '../src/llm/formats/schema-sanitizer';

// ======================== Gemini ========================

describe('sanitizeSchemaForGemini', () => {
  it('将 enum 数字值转为字符串', () => {
    const schema = {
      type: 'object',
      properties: {
        doc_type: { type: 'integer', enum: [3, 10], description: '文档类型' },
      },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
    // type 应从 integer 同步改为 string（enum 值已是字符串）
    expect(result.properties.doc_type.type).toBe('string');
  });

  it('删除 additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.properties.values.additionalProperties).toBeUndefined();
  });

  it('删除 title / default / const', () => {
    const schema = {
      type: 'object',
      title: 'TestSchema',
      properties: {
        name: { type: 'string', title: 'Name', default: 'untitled', const: 'fixed' },
      },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.title).toBeUndefined();
    expect(result.properties.name.title).toBeUndefined();
    expect(result.properties.name.default).toBeUndefined();
    expect(result.properties.name.const).toBeUndefined();
    // type 和 description 等应保留
    expect(result.properties.name.type).toBe('string');
  });

  it('anyOf 与其他字段混用时丢弃 anyOf（Gemini 不支持混用）', () => {
    const schema = {
      type: 'string',
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: '可选字段',
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    // anyOf 被丢弃，type 和 description 保留
    expect(result.anyOf).toBeUndefined();
    expect(result.type).toBe('string');
    expect(result.description).toBe('可选字段');
  });

  it('anyOf 作为唯一有意义字段时展开第一个分支', () => {
    // 模拟：anyOf 是属性的唯一内容（除 title/default 等已被删除的之外）
    const schema = {
      anyOf: [
        { type: 'string', description: '字符串值' },
        { type: 'integer', description: '数字值' },
      ],
      title: 'SomeField',  // 会被删除
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    // 应展开为第一个分支
    expect(result.type).toBe('string');
    expect(result.description).toBe('字符串值');
    expect(result.anyOf).toBeUndefined();
    expect(result.title).toBeUndefined();
  });

  it('递归处理嵌套对象', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            title: 'ItemSchema',
            properties: {
              id: { type: 'integer', title: 'ID' },
            },
            additionalProperties: false,
          },
        },
      },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    const itemSchema = result.properties.items.items;
    expect(itemSchema.title).toBeUndefined();
    expect(itemSchema.additionalProperties).toBeUndefined();
    expect(itemSchema.properties.id.title).toBeUndefined();
    expect(itemSchema.properties.id.type).toBe('integer');
  });

  it('保留 type / description / properties / required / items / enum', () => {
    const schema = {
      type: 'object',
      description: '根对象',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '名称', enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.type).toBe('object');
    expect(result.description).toBe('根对象');
    expect(result.required).toEqual(['name']);
    expect(result.properties.name.type).toBe('string');
    expect(result.properties.name.enum).toEqual(['a', 'b']);
    expect(result.properties.tags.items.type).toBe('string');
  });

  it('null / undefined / 原始值直接返回', () => {
    expect(sanitizeSchemaForGemini(null)).toBeNull();
    expect(sanitizeSchemaForGemini(undefined)).toBeUndefined();
    expect(sanitizeSchemaForGemini('hello')).toBe('hello');
    expect(sanitizeSchemaForGemini(42)).toBe(42);
  });

  it('删除 $defs / definitions', () => {
    const schema = {
      type: 'object',
      $defs: { Foo: { type: 'string' } },
      definitions: { Bar: { type: 'number' } },
      properties: { x: { type: 'string' } },
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.$defs).toBeUndefined();
    expect(result.definitions).toBeUndefined();
    expect(result.properties.x.type).toBe('string');
  });

  it('删除 $schema（MCP 工具 inputSchema 常携带此字段）', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    };
    const result = sanitizeSchemaForGemini(schema) as any;
    expect(result.$schema).toBeUndefined();
    expect(result.type).toBe('object');
    expect(result.properties.query.type).toBe('string');
  });
});

// ======================== OpenAI ========================

describe('sanitizeSchemaForOpenAI', () => {
  it('将 enum 数字值转为字符串', () => {
    const schema = {
      type: 'object',
      properties: {
        doc_type: { type: 'integer', enum: [3, 10] },
      },
    };
    const result = sanitizeSchemaForOpenAI(schema) as any;
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
  });

  it('保留 additionalProperties（OpenAI non-strict 模式支持）', () => {
    const schema = {
      type: 'object',
      properties: {
        values: { type: 'object', additionalProperties: { type: 'string' } },
      },
    };
    const result = sanitizeSchemaForOpenAI(schema) as any;
    expect(result.properties.values.additionalProperties).toEqual({ type: 'string' });
  });

  it('保留 anyOf / oneOf / title / default', () => {
    const schema = {
      type: 'object',
      title: 'TestSchema',
      properties: {
        value: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          title: 'Value',
          default: null,
        },
      },
    };
    const result = sanitizeSchemaForOpenAI(schema) as any;
    expect(result.title).toBe('TestSchema');
    expect(result.properties.value.anyOf).toHaveLength(2);
    expect(result.properties.value.title).toBe('Value');
    expect(result.properties.value.default).toBeNull();
  });

  it('删除 $defs / definitions', () => {
    const schema = {
      type: 'object',
      $defs: { Foo: { type: 'string' } },
      properties: { x: { type: 'string' } },
    };
    const result = sanitizeSchemaForOpenAI(schema) as any;
    expect(result.$defs).toBeUndefined();
  });

  it('删除 $schema', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    };
    const result = sanitizeSchemaForOpenAI(schema) as any;
    expect(result.$schema).toBeUndefined();
    expect(result.type).toBe('object');
  });
});

// ======================== Claude ========================

describe('sanitizeSchemaForClaude', () => {
  it('顶层 anyOf 展开为第一个分支', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { name: { type: 'string' } } },
        { type: 'null' },
      ],
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    expect(result.anyOf).toBeUndefined();
    expect(result.type).toBe('object');
    expect(result.properties.name.type).toBe('string');
  });

  it('嵌套内的 anyOf 保留（Claude 支持嵌套 anyOf）', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    // 嵌套 anyOf 应保留
    expect(result.properties.value.anyOf).toHaveLength(2);
  });

  it('将 enum 数字值转为字符串', () => {
    const schema = {
      type: 'object',
      properties: {
        doc_type: { type: 'integer', enum: [3, 10] },
      },
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
  });

  it('保留 title / default / additionalProperties', () => {
    const schema = {
      type: 'object',
      title: 'Root',
      properties: {
        name: { type: 'string', default: 'untitled', title: 'Name' },
        values: { type: 'object', additionalProperties: { type: 'string' } },
      },
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    expect(result.title).toBe('Root');
    expect(result.properties.name.default).toBe('untitled');
    expect(result.properties.name.title).toBe('Name');
    expect(result.properties.values.additionalProperties).toEqual({ type: 'string' });
  });

  it('删除 $defs / definitions', () => {
    const schema = {
      type: 'object',
      $defs: { Foo: { type: 'string' } },
      definitions: { Bar: { type: 'number' } },
      properties: { x: { type: 'string' } },
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    expect(result.$defs).toBeUndefined();
    expect(result.definitions).toBeUndefined();
  });

  it('删除 $schema', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    };
    const result = sanitizeSchemaForClaude(schema) as any;
    expect(result.$schema).toBeUndefined();
    expect(result.type).toBe('object');
  });
});

// ======================== 对比测试 ========================

describe('三个 sanitizer 的差异化行为', () => {
  const complexSchema = {
    type: 'object',
    title: 'AddRecordInput',
    properties: {
      docid: { type: 'string', title: 'Docid', description: '文档ID' },
      doc_type: { type: 'integer', enum: [3, 10], description: '文档类型' },
      values: {
        type: 'object',
        additionalProperties: {
          anyOf: [
            { type: 'string' },
            { type: 'number' },
            { items: { type: 'object', title: 'TextCell', properties: { text: { type: 'string' } } }, type: 'array' },
          ],
        },
        description: '字段值',
      },
    },
    required: ['docid'],
  };

  it('Gemini: 删除 title + additionalProperties + anyOf，enum 转字符串', () => {
    const result = sanitizeSchemaForGemini(complexSchema) as any;
    expect(result.title).toBeUndefined();
    expect(result.properties.docid.title).toBeUndefined();
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
    expect(result.properties.doc_type.type).toBe('string');  // integer → string（enum 已转字符串）
    expect(result.properties.values.additionalProperties).toBeUndefined();
    // required 应保留
    expect(result.required).toEqual(['docid']);
  });

  it('OpenAI: 保留 title + additionalProperties + anyOf，enum 转字符串', () => {
    const result = sanitizeSchemaForOpenAI(complexSchema) as any;
    expect(result.title).toBe('AddRecordInput');
    expect(result.properties.docid.title).toBe('Docid');
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
    expect(result.properties.values.additionalProperties).toBeDefined();
    expect(result.properties.values.additionalProperties.anyOf).toHaveLength(3);
  });

  it('Claude: 保留 title + additionalProperties + 嵌套 anyOf，enum 转字符串', () => {
    const result = sanitizeSchemaForClaude(complexSchema) as any;
    expect(result.title).toBe('AddRecordInput');
    expect(result.properties.doc_type.enum).toEqual(['3', '10']);
    expect(result.properties.values.additionalProperties).toBeDefined();
    // 嵌套 anyOf 保留
    expect(result.properties.values.additionalProperties.anyOf).toHaveLength(3);
  });
});
