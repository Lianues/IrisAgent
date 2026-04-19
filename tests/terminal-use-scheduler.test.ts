import { describe, expect, it } from 'vitest';
import { buildExecutionPlan, executePlan } from '../src/tools/scheduler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { FunctionCallPart } from '../src/types/index.js';
import type { ToolPolicyConfig } from '../src/config/types.js';

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

function createRegistry(tools: Array<{
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  approvalMode?: 'scheduler' | 'handler';
}>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register({
      declaration: {
        name: tool.name,
        description: `tool ${tool.name}`,
      },
      handler: tool.handler,
      approvalMode: tool.approvalMode,
    });
  }
  return registry;
}

describe('terminal-use scheduler integration', () => {
  it('exec_terminal_command 在非交互上下文下应被视为命令类工具，允许 handler 自行做安全判定', async () => {
    let terminalHandlerCalled = false;
    let manualHandlerCalled = false;

    const registry = createRegistry([
      {
        name: 'exec_terminal_command',
        approvalMode: 'handler',
        handler: async () => {
          terminalHandlerCalled = true;
          return { ok: true };
        },
      },
      {
        name: 'manual_tool',
        handler: async () => {
          manualHandlerCalled = true;
          return { ok: true };
        },
      },
    ]);

    const calls = [
      fc('exec_terminal_command', { command: 'git status' }),
      fc('manual_tool'),
    ];
    const plan = buildExecutionPlan(calls, registry);
    const policies = {
      permissions: {
        exec_terminal_command: { autoApprove: false } as ToolPolicyConfig,
        manual_tool: { autoApprove: false } as ToolPolicyConfig,
      },
    };

    const results = await executePlan(calls, plan, registry, undefined, undefined, policies);
    const terminalResponse = results[0].functionResponse.response as Record<string, unknown>;
    const manualResponse = results[1].functionResponse.response as Record<string, unknown>;

    expect(terminalHandlerCalled).toBe(true);
    expect(terminalResponse.error).toBeUndefined();

    expect(manualHandlerCalled).toBe(false);
    expect(String(manualResponse.error || '')).toContain('人工确认');
  });
});
