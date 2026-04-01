import { describe, it, expect } from 'vitest';
import { coerceToolArgs, getToolArgsArrayValidationError } from '../src/tools/coerce-args';

function schema(
  properties: Record<string, Record<string, unknown>>,
  required?: string[],
) {
  return { type: 'object' as const, properties, required };
}

describe('coerceToolArgs', () => {
  // ==================== 基础守卫 ====================

  it('在没有 schema 时保持原值', () => {
    const args = { files: '[{"path":"a.txt"}]' };
    expect(coerceToolArgs(args, undefined)).toBe(args);
  });

  // ==================== boolean 容错 ====================

  it('将 "true" 字符串转为 true', () => {
    const args = { recursive: 'true' };
    const s = schema({ recursive: { type: 'boolean' } });
    const result = coerceToolArgs(args, s);
    expect(result.recursive).toBe(true);
    expect(typeof result.recursive).toBe('boolean');
  });

  it('将 "false" 字符串转为 false', () => {
    const args = { recursive: 'false' };
    const s = schema({ recursive: { type: 'boolean' } });
    const result = coerceToolArgs(args, s);
    expect(result.recursive).toBe(false);
    expect(typeof result.recursive).toBe('boolean');
  });

  it('对已经是 boolean 的值不做处理', () => {
    const args = { recursive: true };
    const s = schema({ recursive: { type: 'boolean' } });
    expect(coerceToolArgs(args, s)).toBe(args);
  });

  it('不转换非 "true"/"false" 的 boolean 字符串', () => {
    const args = { recursive: 'yes' };
    const s = schema({ recursive: { type: 'boolean' } });
    const result = coerceToolArgs(args, s);
    expect(result.recursive).toBe('yes');
  });

  // ==================== number 容错 ====================

  it('将 "60000" 字符串转为 60000', () => {
    const args = { timeout: '60000' };
    const s = schema({ timeout: { type: 'number' } });
    const result = coerceToolArgs(args, s);
    expect(result.timeout).toBe(60000);
    expect(typeof result.timeout).toBe('number');
  });

  it('将 "-5" 字符串转为 -5', () => {
    const args = { offset: '-5' };
    const s = schema({ offset: { type: 'number' } });
    const result = coerceToolArgs(args, s);
    expect(result.offset).toBe(-5);
  });

  it('将 "3.14" 字符串转为 3.14', () => {
    const args = { ratio: '3.14' };
    const s = schema({ ratio: { type: 'number' } });
    const result = coerceToolArgs(args, s);
    expect(result.ratio).toBe(3.14);
  });

  it('对 integer 类型同样生效', () => {
    const args = { count: '42' };
    const s = schema({ count: { type: 'integer' } });
    const result = coerceToolArgs(args, s);
    expect(result.count).toBe(42);
  });

  it('对已经是 number 的值不做处理', () => {
    const args = { timeout: 60000 };
    const s = schema({ timeout: { type: 'number' } });
    expect(coerceToolArgs(args, s)).toBe(args);
  });

  it('不转换非法数字字符串', () => {
    const args = { timeout: '12px' };
    const s = schema({ timeout: { type: 'number' } });
    const result = coerceToolArgs(args, s);
    expect(result.timeout).toBe('12px');
  });

  it('不转换空字符串', () => {
    const args = { timeout: '' };
    const s = schema({ timeout: { type: 'number' } });
    const result = coerceToolArgs(args, s);
    expect(result.timeout).toBe('');
  });

  // ==================== array 容错 ====================

  it('对已经是数组的参数不做处理', () => {
    const args = { files: [{ path: 'a.txt', content: 'hello' }] };
    const s = schema({
      files: {
        type: 'array',
        items: { type: 'object', properties: { path: { type: 'string' } } },
      },
    });
    expect(coerceToolArgs(args, s)).toBe(args);
  });

  it('将 JSON 字符串转为数组', () => {
    const args = { files: '[{"path":"a.txt","content":"hello"}]' };
    const s = schema({
      files: {
        type: 'array',
        items: { type: 'object', properties: { path: { type: 'string' } } },
      },
    });
    const result = coerceToolArgs(args, s);
    expect(result).toEqual({ files: [{ path: 'a.txt', content: 'hello' }] });
    expect(Array.isArray(result.files)).toBe(true);
  });

  it('不递归解析双层字符串数组', () => {
    const single = JSON.stringify([{ path: 'a.txt' }]);
    const double = JSON.stringify(single);
    const args = { files: double };
    const s = schema({
      files: { type: 'array', items: { type: 'object' } },
    });
    const result = coerceToolArgs(args, s);
    // 双层字符串解析出来是 string 而非 array，不替换
    expect(result).toBe(args);
  });

  it('不自动纠正 object 类型字符串', () => {
    const args = { config: '{"key":"foo"}' };
    const s = schema({ config: { type: 'object' } });
    expect(coerceToolArgs(args, s)).toBe(args);
  });

  // ==================== 混合场景 ====================

  it('同时处理多个不同类型的参数', () => {
    const args = {
      recursive: 'true',
      timeout: '60000',
      files: '[{"path":"a.txt"}]',
      query: 'hello',
    };
    const s = schema({
      recursive: { type: 'boolean' },
      timeout: { type: 'number' },
      files: { type: 'array', items: { type: 'object' } },
      query: { type: 'string' },
    });
    const result = coerceToolArgs(args, s);
    expect(result.recursive).toBe(true);
    expect(result.timeout).toBe(60000);
    expect(result.files).toEqual([{ path: 'a.txt' }]);
    expect(result.query).toBe('hello');
  });

  it('所有值都已是正确类型时返回原始对象引用', () => {
    const args = { recursive: true, timeout: 60000, query: 'hello' };
    const s = schema({
      recursive: { type: 'boolean' },
      timeout: { type: 'number' },
      query: { type: 'string' },
    });
    expect(coerceToolArgs(args, s)).toBe(args);
  });
});

describe('getToolArgsArrayValidationError', () => {
  const s = schema({
    files: { type: 'array', items: { type: 'object' } },
  });

  it('数组参数有效时不返回错误', () => {
    const args = { files: [{ path: 'a.txt' }] };
    expect(getToolArgsArrayValidationError('write_file', args, s)).toBeNull();
  });

  it('字符串未能转成数组时返回明确错误', () => {
    const args = { files: '{"path":"a.txt"}' };
    expect(getToolArgsArrayValidationError('write_file', args, s)).toBe(
      'Tool "write_file" expects parameter "files" to be an array. The model returned a string, but it could not be parsed into a JSON array.',
    );
  });

  it('非字符串且非数组时返回通用错误', () => {
    const args = { files: { path: 'a.txt' } };
    expect(getToolArgsArrayValidationError('write_file', args, s)).toBe(
      'Tool "write_file" expects parameter "files" to be an array.',
    );
  });
});
