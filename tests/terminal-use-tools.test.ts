import { describe, expect, it } from 'vitest';
import { createTerminalUseTools, TERMINAL_USE_FUNCTION_NAMES } from '../extensions/terminal-use/src/tools.js';

const baseState = {
  display: '$ ',
  rows: 32,
  cols: 120,
  cursorRow: 0,
  cursorCol: 2,
  promptReady: true,
  altScreen: false,
  shellKind: 'bash' as const,
  cwd: '/tmp/project',
};

describe('terminal-use tools', () => {
  it('应注册 restart_terminal，并调用 restartEnv 返回新快照', async () => {
    let restartCalls = 0;
    const restartedState = {
      ...baseState,
      display: 'new shell ready',
    };

    const tools = createTerminalUseTools({
      getEnv: async () => ({
        ...baseState,
        snapshot: async () => baseState,
        execCommand: async () => ({ ...baseState, command: 'pwd' }),
        typeText: async () => baseState,
        pressKey: async () => baseState,
        scroll: async () => baseState,
        wait: async () => baseState,
        interrupt: async () => baseState,
        shellKind: 'bash' as const,
      } as any),
      restartEnv: async () => {
        restartCalls += 1;
        return restartedState;
      },
      getConfig: () => ({
        enabled: true,
        cwd: '/tmp/project',
        cols: 120,
        rows: 32,
        scrollback: 5000,
        startupTimeoutMs: 10000,
        defaultCommandTimeoutMs: 30000,
        defaultWaitTimeoutMs: 10000,
        idleQuietMs: 350,
        maxDisplayChars: 12000,
        maxCommandOutputChars: 50000,
        maxRecentSnapshots: 3,
      }),
      getRouter: () => undefined,
      getToolsConfig: () => ({
        getTerminalSnapshotAutoApprove: true,
        restartTerminalAutoApprove: false,
        execTerminalCommandClassifier: { enabled: true },
        typeTerminalTextAutoApprove: false,
        pressTerminalKeyAutoApprove: false,
        scrollTerminalAutoApprove: true,
        waitTerminalAutoApprove: true,
        interruptTerminalAutoApprove: false,
      }),
    });

    expect(TERMINAL_USE_FUNCTION_NAMES.has('restart_terminal')).toBe(true);
    const restartTool = tools.find(tool => tool.declaration.name === 'restart_terminal');
    expect(restartTool).toBeDefined();

    const result = await restartTool!.handler({}, { approvedByUser: true } as any);
    expect(restartCalls).toBe(1);
    expect(result).toEqual({
      screen: 'new shell ready',
      meta: {
        rows: 32,
        cols: 120,
        cursorRow: 0,
        cursorCol: 2,
        promptReady: true,
        altScreen: false,
        shellKind: 'bash',
        cwd: '/tmp/project',
      },
    });
  });

  it('应将 snapshot / exec 结果转换为 screen + meta 结构', async () => {
    const tools = createTerminalUseTools({
      getEnv: async () => ({
        snapshot: async () => ({ ...baseState, scrollback: { offset: 0, maxOffset: 10 } }),
        execCommand: async () => ({
          ...baseState,
          command: 'pwd',
          commandOutput: '/tmp/project',
          exitCode: 0,
          scrollback: { offset: 0, maxOffset: 10 },
        }),
        typeText: async () => baseState,
        pressKey: async () => baseState,
        scroll: async () => baseState,
        wait: async () => baseState,
        interrupt: async () => baseState,
        shellKind: 'bash' as const,
      } as any),
      restartEnv: async () => baseState,
      getConfig: () => ({
        enabled: true,
        cwd: '/tmp/project',
        cols: 120,
        rows: 32,
        scrollback: 5000,
        startupTimeoutMs: 10000,
        defaultCommandTimeoutMs: 30000,
        defaultWaitTimeoutMs: 10000,
        idleQuietMs: 350,
        maxDisplayChars: 12000,
        maxCommandOutputChars: 50000,
        maxRecentSnapshots: 3,
      }),
      getRouter: () => undefined,
      getToolsConfig: () => ({
        getTerminalSnapshotAutoApprove: true,
        restartTerminalAutoApprove: false,
        execTerminalCommandClassifier: { enabled: true },
        typeTerminalTextAutoApprove: false,
        pressTerminalKeyAutoApprove: false,
        scrollTerminalAutoApprove: true,
        waitTerminalAutoApprove: true,
        interruptTerminalAutoApprove: false,
      }),
    });

    const snapshotTool = tools.find(tool => tool.declaration.name === 'get_terminal_snapshot');
    const execTool = tools.find(tool => tool.declaration.name === 'exec_terminal_command');
    expect(snapshotTool).toBeDefined();
    expect(execTool).toBeDefined();

    const snapshotResult = await snapshotTool!.handler({});
    expect(snapshotResult).toEqual({
      screen: '$ ',
      meta: {
        rows: 32,
        cols: 120,
        cursorRow: 0,
        cursorCol: 2,
        promptReady: true,
        altScreen: false,
        shellKind: 'bash',
        cwd: '/tmp/project',
        scrollback: { offset: 0, maxOffset: 10 },
      },
    });

    const execResult = await execTool!.handler({ command: 'pwd' }, { approvedByUser: true } as any);
    expect(execResult).toEqual({
      screen: '$ ',
      command: 'pwd',
      commandOutput: '/tmp/project',
      meta: {
        rows: 32,
        cols: 120,
        cursorRow: 0,
        cursorCol: 2,
        promptReady: true,
        altScreen: false,
        shellKind: 'bash',
        cwd: '/tmp/project',
        scrollback: { offset: 0, maxOffset: 10 },
        exitCode: 0,
      },
    });
  });
});
