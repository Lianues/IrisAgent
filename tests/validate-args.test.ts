import { describe, it, expect } from 'vitest';
import { validateToolArgs } from '../src/tools/validate-args';

function schema(
  properties: Record<string, Record<string, unknown>>,
  required?: string[],
) {
  return { type: 'object' as const, properties, required };
}

describe('validateToolArgs', () => {
  // ==================== 基础守卫 ====================

  it('没有 schema 时返回 null', () => {
    expect(validateToolArgs('test', { a: 1 }, undefined)).toBeNull();
  });

  it('参数完全符合 schema 时返回 null', () => {
    const s = schema(
      { path: { type: 'string' }, content: { type: 'string' } },
      ['path', 'content'],
    );
    expect(validateToolArgs('write_file', { path: 'a.txt', content: 'hello' }, s)).toBeNull();
  });

  // ==================== 必需字段缺失 ====================

  it('缺少必需参数时返回可读错误', () => {
    const s = schema(
      { path: { type: 'string' }, content: { type: 'string' } },
      ['path', 'content'],
    );
    const error = validateToolArgs('write_file', { path: 'a.txt' }, s);
    expect(error).not.toBeNull();
    expect(error).toContain('write_file failed');
    expect(error).toContain('The required parameter `content` is missing');
  });

  it('缺少多个必需参数时列出所有缺失项', () => {
    const s = schema(
      { path: { type: 'string' }, content: { type: 'string' } },
      ['path', 'content'],
    );
    const error = validateToolArgs('write_file', {}, s);
    expect(error).toContain('issues');
    expect(error).toContain('`path` is missing');
    expect(error).toContain('`content` is missing');
  });

  // ==================== 类型不匹配 ====================

  it('类型不匹配时返回可读错误', () => {
    const s = schema({ timeout: { type: 'number' } }, ['timeout']);
    const error = validateToolArgs('execute_command', { timeout: 'abc' }, s);
    expect(error).not.toBeNull();
    expect(error).toContain('`timeout`');
    expect(error).toContain('expected as `number`');
    expect(error).toContain('provided as `string`');
  });

  it('期望 array 但收到 object 时报错', () => {
    const s = schema({ files: { type: 'array' } }, ['files']);
    const error = validateToolArgs('write_file', { files: { path: 'a.txt' } }, s);
    expect(error).toContain('expected as `array`');
    expect(error).toContain('provided as `object`');
  });

  it('期望 boolean 但收到 string 时报错', () => {
    const s = schema({ recursive: { type: 'boolean' } }, ['recursive']);
    const error = validateToolArgs('list_files', { recursive: 'yes' }, s);
    expect(error).toContain('expected as `boolean`');
    expect(error).toContain('provided as `string`');
  });

  it('integer 类型收到浮点数时报错', () => {
    const s = schema({ line: { type: 'integer' } }, ['line']);
    const error = validateToolArgs('insert_code', { line: 3.14 }, s);
    expect(error).toContain('expected as `integer`');
  });

  it('integer 类型收到整数时通过', () => {
    const s = schema({ line: { type: 'integer' } }, ['line']);
    expect(validateToolArgs('insert_code', { line: 5 }, s)).toBeNull();
  });

  // ==================== 多余字段 ====================

  it('提供了 schema 中未定义的参数时报错', () => {
    const s = schema({ path: { type: 'string' } }, ['path']);
    const error = validateToolArgs('read_file', { path: 'a.txt', nonexistent: 123 }, s);
    expect(error).toContain('unexpected parameter `nonexistent`');
  });

  // ==================== 混合场景 ====================

  it('同时存在多种错误时全部列出', () => {
    const s = schema(
      { path: { type: 'string' }, line: { type: 'number' } },
      ['path', 'line'],
    );
    const error = validateToolArgs('insert_code', { line: 'abc', extra: true }, s);
    expect(error).not.toBeNull();
    expect(error).toContain('`path` is missing');
    expect(error).toContain('`line`');
    expect(error).toContain('expected as `number`');
    expect(error).toContain('unexpected parameter `extra`');
  });

  // ==================== 边界情况 ====================

  it('可选参数缺失时不报错', () => {
    const s = schema(
      { path: { type: 'string' }, encoding: { type: 'string' } },
      ['path'],
    );
    expect(validateToolArgs('read_file', { path: 'a.txt' }, s)).toBeNull();
  });

  it('参数值为 null 时跳过类型检查', () => {
    const s = schema({ path: { type: 'string' } }, []);
    expect(validateToolArgs('read_file', { path: null as any }, s)).toBeNull();
  });

  it('schema 没有 required 字段时不检查必需性', () => {
    const s = schema({ path: { type: 'string' } });
    expect(validateToolArgs('read_file', {}, s)).toBeNull();
  });
});
