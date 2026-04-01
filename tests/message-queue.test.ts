/**
 * 消息队列单元测试
 *
 * 覆盖：
 *   - 优先级排序（user > notification）
 *   - 同优先级 FIFO
 *   - dequeue 的 sessionId 过滤
 *   - dequeue 的 excludeSessions 过滤
 *   - clearSession 清空指定会话
 *   - requeue 不触发事件、不改变时间戳
 *   - hasMessages / getSessionMessageCount 查询
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageQueue } from '../src/core/message-queue.js';

// ============ 辅助函数 ============

/**
 * 创建一条最简用户入队参数。
 * 省略 priority/mode/enqueuedAt，这些由 enqueueUser/enqueueNotification 自动设定。
 */
function userMsg(sessionId: string, text: string) {
  return { sessionId, text };
}

function notifMsg(sessionId: string, text: string) {
  return { sessionId, text };
}

// ============ 测试 ============

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  // ---- 优先级排序 ----

  it('user 消息先于 notification 消息出队（优先级排序）', () => {
    // 先入队一条低优先级的 notification
    queue.enqueueNotification(notifMsg('s1', 'notif-1'));
    // 再入队一条高优先级的 user 消息
    queue.enqueueUser(userMsg('s1', 'user-1'));

    // 即使 notification 先入队，user 应先出队
    const first = queue.dequeue();
    expect(first).toBeDefined();
    expect(first!.text).toBe('user-1');
    expect(first!.priority).toBe('user');

    const second = queue.dequeue();
    expect(second).toBeDefined();
    expect(second!.text).toBe('notif-1');
    expect(second!.priority).toBe('notification');
  });

  // ---- 同优先级 FIFO ----

  it('同优先级按入队顺序出队（FIFO）', () => {
    queue.enqueueUser(userMsg('s1', 'first'));
    queue.enqueueUser(userMsg('s1', 'second'));
    queue.enqueueUser(userMsg('s1', 'third'));

    expect(queue.dequeue()!.text).toBe('first');
    expect(queue.dequeue()!.text).toBe('second');
    expect(queue.dequeue()!.text).toBe('third');
  });

  it('notification 同优先级也按 FIFO', () => {
    queue.enqueueNotification(notifMsg('s1', 'n1'));
    queue.enqueueNotification(notifMsg('s1', 'n2'));

    expect(queue.dequeue()!.text).toBe('n1');
    expect(queue.dequeue()!.text).toBe('n2');
  });

  // ---- dequeue 的 sessionId 过滤 ----

  it('dequeue 的 sessionId 过滤参数正常工作', () => {
    queue.enqueueUser(userMsg('s1', 'msg-s1'));
    queue.enqueueUser(userMsg('s2', 'msg-s2'));

    // 只取 s2 的消息
    const msg = queue.dequeue('s2');
    expect(msg).toBeDefined();
    expect(msg!.text).toBe('msg-s2');
    expect(msg!.sessionId).toBe('s2');

    // s1 的消息仍在队列中
    expect(queue.length).toBe(1);
    expect(queue.dequeue('s1')!.text).toBe('msg-s1');
  });

  // ---- dequeue 的 excludeSessions 过滤 ----

  it('dequeue 的 excludeSessions 参数正常工作', () => {
    queue.enqueueUser(userMsg('s1', 'msg-s1'));
    queue.enqueueUser(userMsg('s2', 'msg-s2'));
    queue.enqueueUser(userMsg('s3', 'msg-s3'));

    // 排除 s1 和 s3，只能取到 s2
    const msg = queue.dequeue(undefined, new Set(['s1', 's3']));
    expect(msg).toBeDefined();
    expect(msg!.sessionId).toBe('s2');

    // s1 和 s3 的消息仍在队列中
    expect(queue.length).toBe(2);
  });

  it('excludeSessions 排除所有 session 时返回 undefined', () => {
    queue.enqueueUser(userMsg('s1', 'msg-s1'));
    const msg = queue.dequeue(undefined, new Set(['s1']));
    expect(msg).toBeUndefined();
    // 消息没有被移除
    expect(queue.length).toBe(1);
  });

  // ---- clearSession ----

  it('clearSession 只清空指定会话的消息', () => {
    queue.enqueueUser(userMsg('s1', 'a'));
    queue.enqueueUser(userMsg('s2', 'b'));
    queue.enqueueNotification(notifMsg('s1', 'c'));

    queue.clearSession('s1');

    // s1 的两条消息被清空，s2 的消息保留
    expect(queue.length).toBe(1);
    expect(queue.dequeue()!.sessionId).toBe('s2');
  });

  // ---- requeue ----

  it('requeue 放回的消息不触发 enqueued 事件、不改变时间戳', () => {
    const spy = vi.fn();
    queue.on('enqueued', spy);

    // 先入队一条消息（触发一次事件）
    queue.enqueueUser(userMsg('s1', 'original'));
    expect(spy).toHaveBeenCalledTimes(1);

    // 取出
    const msg = queue.dequeue()!;
    const originalTimestamp = msg.enqueuedAt;

    // 放回（不应触发事件）
    spy.mockClear();
    queue.requeue(msg);
    expect(spy).not.toHaveBeenCalled();

    // 时间戳不变
    const retrieved = queue.dequeue()!;
    expect(retrieved.enqueuedAt).toBe(originalTimestamp);
    expect(retrieved.text).toBe('original');
  });

  // ---- hasMessages / getSessionMessageCount ----

  it('hasMessages / getSessionMessageCount 查询准确', () => {
    expect(queue.hasMessages()).toBe(false);
    expect(queue.hasMessages('s1')).toBe(false);
    expect(queue.getSessionMessageCount('s1')).toBe(0);

    queue.enqueueUser(userMsg('s1', 'a'));
    queue.enqueueNotification(notifMsg('s1', 'b'));
    queue.enqueueUser(userMsg('s2', 'c'));

    expect(queue.hasMessages()).toBe(true);
    expect(queue.hasMessages('s1')).toBe(true);
    expect(queue.hasMessages('s2')).toBe(true);
    expect(queue.hasMessages('s3')).toBe(false);

    expect(queue.getSessionMessageCount('s1')).toBe(2);
    expect(queue.getSessionMessageCount('s2')).toBe(1);
    expect(queue.getSessionMessageCount('s3')).toBe(0);
  });

  // ---- 入队事件 ----

  it('enqueueUser 和 enqueueNotification 都会 emit enqueued 事件', () => {
    const spy = vi.fn();
    queue.on('enqueued', spy);

    queue.enqueueUser(userMsg('s1', 'a'));
    queue.enqueueNotification(notifMsg('s1', 'b'));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ---- 空队列 dequeue ----

  it('空队列 dequeue 返回 undefined', () => {
    expect(queue.dequeue()).toBeUndefined();
  });

  // ---- mode 字段 ----

  it('enqueueUser 设定 mode 为 chat，enqueueNotification 设定 mode 为 task-notification', () => {
    queue.enqueueUser(userMsg('s1', 'a'));
    queue.enqueueNotification(notifMsg('s1', 'b'));

    // user 消息先出队
    const u = queue.dequeue()!;
    expect(u.mode).toBe('chat');

    const n = queue.dequeue()!;
    expect(n.mode).toBe('task-notification');
  });

  // ---- 混合优先级 + 多 session ----

  it('混合优先级 + 多 session：user 消息永远先于 notification', () => {
    queue.enqueueNotification(notifMsg('s1', 'n1'));
    queue.enqueueNotification(notifMsg('s2', 'n2'));
    queue.enqueueUser(userMsg('s2', 'u2'));
    queue.enqueueUser(userMsg('s1', 'u1'));

    // 两条 user 消息先出（FIFO 顺序：u2 先入队，所以 u2 先出）
    const first = queue.dequeue()!;
    expect(first.priority).toBe('user');
    expect(first.text).toBe('u2');

    const second = queue.dequeue()!;
    expect(second.priority).toBe('user');
    expect(second.text).toBe('u1');

    // 再出两条 notification
    const third = queue.dequeue()!;
    expect(third.priority).toBe('notification');
    const fourth = queue.dequeue()!;
    expect(fourth.priority).toBe('notification');
  });
});
