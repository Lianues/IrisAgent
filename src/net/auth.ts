/**
 * Net 认证工具
 *
 * 提供常量时间 token 比较和认证消息校验。
 */

import type { NetAuthMessage } from './types';

/**
 * 常量时间字符串比较，防止时序攻击。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 长度不同仍然执行等长比较，避免泄露长度信息
    let result = 1;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      result |= (a.charCodeAt(i % a.length) ?? 0) ^ (b.charCodeAt(i % b.length) ?? 0);
    }
    return false; // 长度不同一定不相等
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 校验认证消息。
 *
 * @returns valid=true 如果消息格式正确且 token 匹配
 */
export function validateAuthMessage(
  raw: string,
  expectedToken: string,
): { valid: boolean; error?: string } {
  let msg: NetAuthMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { valid: false, error: 'invalid_json' };
  }

  if (!msg || msg.type !== 'auth' || typeof msg.token !== 'string') {
    return { valid: false, error: 'invalid_format' };
  }

  if (!constantTimeEqual(msg.token, expectedToken)) {
    return { valid: false, error: 'token_mismatch' };
  }

  return { valid: true };
}
