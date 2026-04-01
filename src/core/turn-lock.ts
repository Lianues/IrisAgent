/**
 * Per-session Turn 锁
 *
 * 防止同一 session 并发执行多个 turn（LLM 调用 + 工具循环）。
 * 不同 session 之间互不影响，可以并行。
 *
 * 两状态状态机：
 *   idle → running → idle
 *
 * 设计动机：
 *   引入消息队列后，drainQueue() 会在多个时机被触发
 *   （消息入队、turn 结束、手动调用等）。
 *   如果没有 turn 锁，同一 session 可能被同时启动两个 turn，
 *   导致对话历史交叉写入、LLM 上下文混乱。
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';

const logger = createLogger('TurnLock');

export class TurnLock extends EventEmitter {
  /**
   * 每个 sessionId 的当前状态。
   * 未在 Map 中的 session 视为 idle。
   */
  private locks = new Map<string, 'idle' | 'running'>();

  /**
   * 尝试获取指定 session 的 turn 锁。
   *
   * 当前状态为 idle（或未记录）时，切为 running 并返回 true。
   * 当前状态为 running 时，返回 false（该 session 正在执行 turn）。
   *
   * @param sessionId 会话 ID
   * @returns 是否成功获取锁
   */
  tryAcquire(sessionId: string): boolean {
    const current = this.locks.get(sessionId) ?? 'idle';
    if (current === 'running') {
      return false;
    }
    this.locks.set(sessionId, 'running');
    logger.debug(`Turn 锁已获取: session=${sessionId}`);
    return true;
  }

  /**
   * 释放指定 session 的 turn 锁。
   *
   * 切回 idle 状态，然后 emit 'released' 事件。
   * Backend 监听此事件来触发 drainQueue()，
   * 检查该 session 是否还有待处理的消息（如异步子代理通知）。
   *
   * @param sessionId 会话 ID
   */
  release(sessionId: string): void {
    const current = this.locks.get(sessionId);
    if (current !== 'running') {
      // 非 running 状态的 release 是空操作（防止重复 release）
      return;
    }
    this.locks.set(sessionId, 'idle');
    logger.debug(`Turn 锁已释放: session=${sessionId}`);
    this.emit('released', sessionId);
  }

  /**
   * 查询指定 session 是否正在执行 turn。
   */
  isActive(sessionId: string): boolean {
    return this.locks.get(sessionId) === 'running';
  }

  /**
   * 查询是否有任何 session 正在执行 turn。
   */
  hasAnyActive(): boolean {
    for (const status of this.locks.values()) {
      if (status === 'running') return true;
    }
    return false;
  }

  /**
   * 清除指定 session 的锁状态记录。
   * 在 clearSession 时调用，释放内存。
   */
  clear(sessionId: string): void {
    this.locks.delete(sessionId);
  }

  /**
   * 清除所有锁状态。
   */
  clearAll(): void {
    this.locks.clear();
  }
}
