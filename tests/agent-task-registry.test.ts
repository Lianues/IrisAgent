/**
 * 异步子代理任务注册表单元测试
 *
 * 覆盖：
 *   - register 创建 running 状态的任务并含 AbortController
 *   - complete 将状态切为 completed 并清除 AbortController
 *   - fail 将状态切为 failed 并记录错误信息
 *   - kill 调用 abort() 并切为 killed
 *   - 非 running 状态的 complete/fail/kill 是空操作
 *   - getBySession 返回指定会话的所有任务
 *   - getRunningBySession 只返回 running 状态的
 *   - killAllBySession 批量中止指定会话的所有任务
 *   - clearCompleted 只删除非 running 的记录
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentTaskRegistry, createTaskId } from '../src/core/agent-task-registry.js';

describe('AgentTaskRegistry', () => {
  let registry: AgentTaskRegistry;

  beforeEach(() => {
    registry = new AgentTaskRegistry();
  });

  // ---- register ----

  it('register 创建 running 状态的任务并含 AbortController', () => {
    const task = registry.register('task-1', 'session-a', '测试任务');

    expect(task.taskId).toBe('task-1');
    expect(task.sessionId).toBe('session-a');
    expect(task.description).toBe('测试任务');
    expect(task.status).toBe('running');
    expect(task.abortController).toBeDefined();
    expect(task.abortController).toBeInstanceOf(AbortController);
    expect(task.startTime).toBeGreaterThan(0);
    expect(task.endTime).toBeUndefined();
  });

  // ---- complete ----

  it('complete 将状态切为 completed 并清除 AbortController', () => {
    registry.register('task-1', 'session-a', '测试');
    registry.complete('task-1', '执行结果文本');

    const task = registry.get('task-1')!;
    expect(task.status).toBe('completed');
    expect(task.result).toBe('执行结果文本');
    expect(task.abortController).toBeUndefined();
    expect(task.endTime).toBeGreaterThan(0);
  });

  // ---- fail ----

  it('fail 将状态切为 failed 并记录错误信息', () => {
    registry.register('task-1', 'session-a', '测试');
    registry.fail('task-1', 'LLM 调用超时');

    const task = registry.get('task-1')!;
    expect(task.status).toBe('failed');
    expect(task.error).toBe('LLM 调用超时');
    expect(task.abortController).toBeUndefined();
    expect(task.endTime).toBeGreaterThan(0);
  });

  // ---- kill ----

  it('kill 调用 abort() 并切为 killed', () => {
    const task = registry.register('task-1', 'session-a', '测试');
    const abortSpy = vi.spyOn(task.abortController!, 'abort');

    registry.kill('task-1');

    expect(abortSpy).toHaveBeenCalledTimes(1);
    const updated = registry.get('task-1')!;
    expect(updated.status).toBe('killed');
    expect(updated.abortController).toBeUndefined();
    expect(updated.endTime).toBeGreaterThan(0);
  });

  // ---- 非 running 状态的终态操作是空操作 ----

  it('非 running 状态的 complete/fail/kill 是空操作', () => {
    registry.register('task-1', 'session-a', '测试');
    registry.complete('task-1', 'done');

    // 已完成后再 fail → 不改变状态
    registry.fail('task-1', 'error');
    expect(registry.get('task-1')!.status).toBe('completed');
    expect(registry.get('task-1')!.error).toBeUndefined();

    // 已完成后再 kill → 不改变状态
    registry.kill('task-1');
    expect(registry.get('task-1')!.status).toBe('completed');

    // 已完成后再 complete → 不改变结果
    registry.complete('task-1', 'new result');
    expect(registry.get('task-1')!.result).toBe('done');
  });

  it('对不存在的 taskId 调用 complete/fail/kill 不报错', () => {
    // 不应抛出异常
    registry.complete('nonexistent', 'result');
    registry.fail('nonexistent', 'error');
    registry.kill('nonexistent');
  });

  // ---- getBySession ----

  it('getBySession 返回指定会话的所有任务', () => {
    registry.register('t1', 'session-a', '任务1');
    registry.register('t2', 'session-a', '任务2');
    registry.register('t3', 'session-b', '任务3');
    registry.complete('t1', 'done');

    const sessionATasks = registry.getBySession('session-a');
    expect(sessionATasks).toHaveLength(2);
    expect(sessionATasks.map(t => t.taskId).sort()).toEqual(['t1', 't2']);

    const sessionBTasks = registry.getBySession('session-b');
    expect(sessionBTasks).toHaveLength(1);
    expect(sessionBTasks[0].taskId).toBe('t3');

    // 不存在的 session
    expect(registry.getBySession('session-c')).toHaveLength(0);
  });

  // ---- getRunningBySession ----

  it('getRunningBySession 只返回 running 状态的', () => {
    registry.register('t1', 'session-a', '任务1');
    registry.register('t2', 'session-a', '任务2');
    registry.complete('t1', 'done');

    const running = registry.getRunningBySession('session-a');
    expect(running).toHaveLength(1);
    expect(running[0].taskId).toBe('t2');
  });

  // ---- killAllBySession ----

  it('killAllBySession 批量中止指定会话的所有运行中任务', () => {
    const t1 = registry.register('t1', 'session-a', '任务1');
    const t2 = registry.register('t2', 'session-a', '任务2');
    registry.register('t3', 'session-b', '任务3');
    // t1 先完成，只有 t2 是 running
    registry.complete('t1', 'done');

    const t2AbortSpy = vi.spyOn(t2.abortController!, 'abort');

    registry.killAllBySession('session-a');

    // t2 被中止
    expect(t2AbortSpy).toHaveBeenCalledTimes(1);
    expect(registry.get('t2')!.status).toBe('killed');
    // t1 状态不变（已经是 completed）
    expect(registry.get('t1')!.status).toBe('completed');
    // session-b 的任务不受影响
    expect(registry.get('t3')!.status).toBe('running');
  });

  // ---- clearCompleted ----

  it('clearCompleted 只删除非 running 的记录', () => {
    registry.register('t1', 'session-a', '任务1');
    registry.register('t2', 'session-a', '任务2');
    registry.register('t3', 'session-a', '任务3');
    registry.complete('t1', 'done');
    registry.fail('t2', 'error');
    // t3 仍为 running

    const count = registry.clearCompleted();

    // 删除了 t1（completed）和 t2（failed）
    expect(count).toBe(2);
    expect(registry.get('t1')).toBeUndefined();
    expect(registry.get('t2')).toBeUndefined();
    // t3 仍在
    expect(registry.get('t3')).toBeDefined();
    expect(registry.get('t3')!.status).toBe('running');
    expect(registry.size).toBe(1);
  });

  // ---- createTaskId ----

  it('createTaskId 生成唯一的任务 ID', () => {
    const id1 = createTaskId();
    const id2 = createTaskId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^agent_task_/);
    expect(id2).toMatch(/^agent_task_/);
  });

  // ---- 事件 ----

  it('register/complete/fail/kill 分别 emit 对应事件', () => {
    const registered = vi.fn();
    const completed = vi.fn();
    const failed = vi.fn();
    const killed = vi.fn();

    registry.on('registered', registered);
    registry.on('completed', completed);
    registry.on('failed', failed);
    registry.on('killed', killed);

    registry.register('t1', 's1', 'd1');
    expect(registered).toHaveBeenCalledTimes(1);

    registry.register('t2', 's1', 'd2');
    registry.register('t3', 's1', 'd3');

    registry.complete('t1', 'ok');
    expect(completed).toHaveBeenCalledTimes(1);

    registry.fail('t2', 'err');
    expect(failed).toHaveBeenCalledTimes(1);

    registry.kill('t3');
    expect(killed).toHaveBeenCalledTimes(1);
  });
});
