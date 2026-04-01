/**
 * 异步子代理任务注册表
 *
 * 管理所有活跃的异步子代理任务。
 * 提供注册、查询、完成、失败、中止等操作。
 *
 * 设计动机：
 *   异步子代理通过 void 启动（fire-and-forget），
 *   主 LLM 立即收到 async_launched 响应。
 *   任务注册表跟踪每个异步子代理的状态，
 *   供 clearSession 时批量中止、供平台层查询后台任务状态。
 *
 * 对标 Claude Code：
 *   AppState.tasks + registerAsyncAgent() / completeAgentTask() /
 *   failAgentTask() / killAsyncAgent()。
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';

const logger = createLogger('AgentTaskRegistry');

/** 异步子代理任务状态 */
export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'killed';

/** 异步子代理任务记录 */
export interface AgentTask {
  /** 任务唯一标识 */
  taskId: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 任务描述（供平台层展示） */
  description: string;
  /** 当前状态 */
  status: AgentTaskStatus;
  /** 中止控制器（仅 running 状态有效） */
  abortController?: AbortController;
  /** 启动时间戳 */
  startTime: number;
  /** 结束时间戳（终态时设置） */
  endTime?: number;
  /** 执行结果文本（completed 时有值） */
  result?: string;
  /** 错误信息（failed 时有值） */
  error?: string;
}

/** 任务 ID 生成计数器 */
let taskCounter = 0;

/** 生成唯一任务 ID */
export function createTaskId(): string {
  return `agent_task_${++taskCounter}_${Date.now()}`;
}

export class AgentTaskRegistry extends EventEmitter {
  private tasks = new Map<string, AgentTask>();

  /**
   * 注册新的异步子代理任务。
   *
   * @param taskId      任务 ID（由 createTaskId() 生成）
   * @param sessionId   所属会话 ID
   * @param description 任务描述
   * @returns 注册的 AgentTask（含 AbortController）
   */
  register(taskId: string, sessionId: string, description: string): AgentTask {
    const task: AgentTask = {
      taskId,
      sessionId,
      description,
      status: 'running',
      abortController: new AbortController(),
      startTime: Date.now(),
    };
    this.tasks.set(taskId, task);
    logger.info(`任务已注册: taskId=${taskId}, session=${sessionId}, desc="${description}"`);
    this.emit('registered', task);
    return task;
  }

  /**
   * 标记任务完成。
   */
  complete(taskId: string, result?: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.status = 'completed';
    task.endTime = Date.now();
    task.result = result;
    task.abortController = undefined;
    logger.info(`任务已完成: taskId=${taskId}, duration=${task.endTime - task.startTime}ms`);
    this.emit('completed', task);
  }

  /**
   * 标记任务失败。
   */
  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.status = 'failed';
    task.endTime = Date.now();
    task.error = error;
    task.abortController = undefined;
    logger.error(`任务已失败: taskId=${taskId}, error="${error}"`);
    this.emit('failed', task);
  }

  /**
   * 中止任务。
   * 调用 AbortController.abort() 通知 ToolLoop 中止。
   */
  kill(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.abortController?.abort();
    task.status = 'killed';
    task.endTime = Date.now();
    task.abortController = undefined;
    logger.info(`任务已中止: taskId=${taskId}`);
    this.emit('killed', task);
  }

  /**
   * 查询任务。
   */
  get(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 查询指定会话下的所有任务。
   */
  getBySession(sessionId: string): AgentTask[] {
    return Array.from(this.tasks.values()).filter(t => t.sessionId === sessionId);
  }

  /**
   * 查询指定会话下所有运行中的任务。
   */
  getRunningBySession(sessionId: string): AgentTask[] {
    return Array.from(this.tasks.values()).filter(t => t.sessionId === sessionId && t.status === 'running');
  }

  /**
   * 中止指定会话下的所有运行中任务。
   * 在 Backend.clearSession() 时调用。
   */
  killAllBySession(sessionId: string): void {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId && task.status === 'running') {
        this.kill(task.taskId);
      }
    }
  }

  /**
   * 清除已终止（非 running）的任务记录，释放内存。
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running') {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }

  /** 当前注册的任务数量 */
  get size(): number {
    return this.tasks.size;
  }
}
