/**
 * Turn 锁单元测试
 *
 * 覆盖：
 *   - tryAcquire 成功时返回 true 并切为 running
 *   - 同一 session 二次 tryAcquire 返回 false
 *   - 不同 session 可以各自独立 acquire
 *   - release 后 emit released 事件
 *   - release 后同一 session 可再次 acquire
 *   - 非 running 状态 release 是空操作不 emit
 *   - clear 删除记录后 isActive 返回 false
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnLock } from '../src/core/turn-lock.js';

describe('TurnLock', () => {
  let lock: TurnLock;

  beforeEach(() => {
    lock = new TurnLock();
  });

  // ---- 基本 acquire ----

  it('tryAcquire 成功时返回 true 并切为 running', () => {
    const result = lock.tryAcquire('s1');
    expect(result).toBe(true);
    expect(lock.isActive('s1')).toBe(true);
  });

  // ---- 同一 session 重复 acquire ----

  it('同一 session 二次 tryAcquire 返回 false', () => {
    lock.tryAcquire('s1');
    const second = lock.tryAcquire('s1');
    expect(second).toBe(false);
    // 状态仍为 running
    expect(lock.isActive('s1')).toBe(true);
  });

  // ---- 不同 session 独立 ----

  it('不同 session 可以各自独立 acquire', () => {
    expect(lock.tryAcquire('s1')).toBe(true);
    expect(lock.tryAcquire('s2')).toBe(true);
    expect(lock.isActive('s1')).toBe(true);
    expect(lock.isActive('s2')).toBe(true);
  });

  // ---- release 事件 ----

  it('release 后 emit released 事件', () => {
    const spy = vi.fn();
    lock.on('released', spy);

    lock.tryAcquire('s1');
    lock.release('s1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('s1');
  });

  // ---- release 后可再次 acquire ----

  it('release 后同一 session 可再次 acquire', () => {
    lock.tryAcquire('s1');
    lock.release('s1');
    expect(lock.isActive('s1')).toBe(false);

    const again = lock.tryAcquire('s1');
    expect(again).toBe(true);
    expect(lock.isActive('s1')).toBe(true);
  });

  // ---- 非 running 状态 release 是空操作 ----

  it('非 running 状态 release 是空操作不 emit', () => {
    const spy = vi.fn();
    lock.on('released', spy);

    // 从未 acquire 过的 session
    lock.release('unknown');
    expect(spy).not.toHaveBeenCalled();

    // 已经 release 过的 session（idle 状态）
    lock.tryAcquire('s1');
    lock.release('s1');
    spy.mockClear();
    lock.release('s1'); // 再次 release
    expect(spy).not.toHaveBeenCalled();
  });

  // ---- clear ----

  it('clear 删除记录后 isActive 返回 false', () => {
    lock.tryAcquire('s1');
    expect(lock.isActive('s1')).toBe(true);

    lock.clear('s1');
    expect(lock.isActive('s1')).toBe(false);
  });

  // ---- hasAnyActive ----

  it('hasAnyActive 在无活跃 session 时返回 false', () => {
    expect(lock.hasAnyActive()).toBe(false);
  });

  it('hasAnyActive 在有活跃 session 时返回 true', () => {
    lock.tryAcquire('s1');
    expect(lock.hasAnyActive()).toBe(true);
    lock.release('s1');
    expect(lock.hasAnyActive()).toBe(false);
  });

  // ---- clearAll ----

  it('clearAll 清除所有锁状态', () => {
    lock.tryAcquire('s1');
    lock.tryAcquire('s2');
    lock.clearAll();
    expect(lock.isActive('s1')).toBe(false);
    expect(lock.isActive('s2')).toBe(false);
    expect(lock.hasAnyActive()).toBe(false);
  });
});
