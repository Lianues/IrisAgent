/**
 * 测试：Agent Context 日志传播
 *
 * 验证 AsyncLocalStorage 驱动的 agent context 能在日志中正确标识
 * 当前代码运行在主 LLM turn 还是某个子代理内部。
 *
 * 覆盖场景：
 *   1. 无 agent context 时，日志前缀保持原样 [Module]
 *   2. 设置 agent context 后，日志前缀变为 [Module|contextLabel]
 *   3. 嵌套的 agentContext.run() 正确覆盖外层 context
 *   4. agentContext.run() 退出后自动恢复外层 context
 *   5. 异步调用链中 context 自动传播（AsyncLocalStorage 核心能力）
 *   6. runWithAgentContext 辅助函数正常工作
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLogger,
  Logger,
  LogLevel,
  setGlobalLogLevel,
  agentContext,
  runWithAgentContext,
} from '../src/logger';

describe('Agent Context 日志传播', () => {
  // 捕获 console 输出以验证日志前缀
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setGlobalLogLevel(LogLevel.DEBUG);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    setGlobalLogLevel(LogLevel.INFO);
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('无 agent context 时，日志前缀保持原样 [Module]', () => {
    // 在 agentContext.run() 外部调用，应无 context 后缀
    const logger = createLogger('ToolScheduler');
    logger.info('执行工具: list_files');

    expect(logSpy).toHaveBeenCalledWith('[ToolScheduler]', '执行工具: list_files');
  });

  it('设置 agent context 后，日志前缀变为 [Module|contextLabel]', () => {
    const logger = createLogger('ToolScheduler');

    agentContext.run('agent_task_1_abc', () => {
      logger.info('执行工具: list_files');
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[ToolScheduler|agent_task_1_abc]',
      '执行工具: list_files',
    );
  });

  it('所有日志级别都携带 agent context', () => {
    const logger = createLogger('TestModule');

    agentContext.run('task_x', () => {
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
    });

    expect(debugSpy).toHaveBeenCalledWith('[TestModule|task_x]', 'debug msg');
    expect(logSpy).toHaveBeenCalledWith('[TestModule|task_x]', 'info msg');
    expect(warnSpy).toHaveBeenCalledWith('[TestModule|task_x]', 'warn msg');
    expect(errorSpy).toHaveBeenCalledWith('[TestModule|task_x]', 'error msg');
  });

  it('嵌套的 agentContext.run() 正确覆盖外层 context', () => {
    const logger = createLogger('ToolLoop');

    agentContext.run('main', () => {
      logger.info('外层');

      agentContext.run('agent_task_2_def', () => {
        logger.info('内层');
      });

      // 退出内层后恢复外层
      logger.info('恢复外层');
    });

    expect(logSpy).toHaveBeenNthCalledWith(1, '[ToolLoop|main]', '外层');
    expect(logSpy).toHaveBeenNthCalledWith(2, '[ToolLoop|agent_task_2_def]', '内层');
    expect(logSpy).toHaveBeenNthCalledWith(3, '[ToolLoop|main]', '恢复外层');
  });

  it('异步调用链中 context 自动传播', async () => {
    const logger = createLogger('SubAgent');

    await agentContext.run('agent_task_3_ghi', async () => {
      // 模拟异步操作（setTimeout、await 等）
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      logger.info('异步完成');
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[SubAgent|agent_task_3_ghi]',
      '异步完成',
    );
  });

  it('并行的异步任务各自保持独立的 context', async () => {
    const logger = createLogger('ToolScheduler');

    // 模拟两个子代理并行运行，各自有独立的 agent context
    const task1 = agentContext.run('task_A', async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 20));
      logger.info('task A done');
    });

    const task2 = agentContext.run('task_B', async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      logger.info('task B done');
    });

    await Promise.all([task1, task2]);

    // task_B 先完成（10ms），task_A 后完成（20ms）
    // 两者的 context 不应互相干扰
    const calls = logSpy.mock.calls;
    const taskBCall = calls.find(c => String(c[1]).includes('task B'));
    const taskACall = calls.find(c => String(c[1]).includes('task A'));

    expect(taskBCall?.[0]).toBe('[ToolScheduler|task_B]');
    expect(taskACall?.[0]).toBe('[ToolScheduler|task_A]');
  });

  it('runWithAgentContext 辅助函数正常工作', async () => {
    const logger = createLogger('ToolLoop');

    await runWithAgentContext('helper_task', async () => {
      logger.info('via helper');
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[ToolLoop|helper_task]',
      'via helper',
    );
  });

  it('runWithAgentContext 正确返回回调的返回值', async () => {
    const result = await runWithAgentContext('ret_task', async () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it('agentContext.run() 退出后日志前缀恢复为无 context', () => {
    const logger = createLogger('Backend');

    agentContext.run('temp_ctx', () => {
      logger.info('inside');
    });

    // 退出 run() 后
    logger.info('outside');

    expect(logSpy).toHaveBeenNthCalledWith(1, '[Backend|temp_ctx]', 'inside');
    expect(logSpy).toHaveBeenNthCalledWith(2, '[Backend]', 'outside');
  });
});
