import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIRTUAL_LOVER_CONFIG, parseVirtualLoverConfig } from '../extensions/virtual-lover/src/config.js';
import { sendProactiveMessage } from '../extensions/virtual-lover/src/proactive.js';
import { createVirtualLoverProactiveTool, VIRTUAL_LOVER_PROACTIVE_TOOL_NAME } from '../extensions/virtual-lover/src/proactive-tool.js';
import { createVirtualLoverScheduleProactiveTool, VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME } from '../extensions/virtual-lover/src/proactive-schedule-tool.js';
import { SCHEDULER_SERVICE_ID } from 'irises-extension-sdk';
import type { PromptBundleSnapshot } from '../extensions/virtual-lover/src/state.js';

function createBundle(): PromptBundleSnapshot {
  return {
    agentId: 'default',
    fragments: {
      persona: 'Persona content',
      style: 'Style content',
      rules: 'Rules content',
    },
  };
}

function createApi(overrides: Record<string, unknown> = {}) {
  const services = new Map<string, unknown>();
  const api = {
    services: {
      get: vi.fn((id: string) => services.get(id)),
      has: vi.fn((id: string) => services.has(id)),
    },
    router: {
      chat: vi.fn(async () => ({ content: { role: 'model', parts: [{ text: 'Generated proactive message.' }] } })),
    },
    __services: services,
    ...overrides,
  } as any;
  return api;
}

describe('virtual-lover proactive MVP', () => {
  it('解析 proactive 默认配置', () => {
    const config = parseVirtualLoverConfig();
    expect(config.proactive.enabled).toBe(false);
    expect(config.proactive.platform).toBe('telegram');
    expect(config.proactive.binding).toBeUndefined();
    expect(config.proactive.policy).toBeUndefined();
    expect(config.proactive.target).toEqual({ kind: 'chat', id: '', accountId: undefined, threadId: undefined, raw: undefined });
    expect(config.proactive.generation.enabled).toBe(true);
  });

  it('未启用 proactive 时拒绝发送', async () => {
    const result = await sendProactiveMessage({
      config: { ...DEFAULT_VIRTUAL_LOVER_CONFIG, enabled: true },
      api: createApi(),
      bundle: createBundle(),
      agentId: 'default',
      text: 'hello',
    });

    expect(result).toMatchObject({ ok: false, sent: false, error: 'proactive.enabled 为 false' });
  });

  it('未启用伴侣模式时拒绝主动发送', async () => {
    const result = await sendProactiveMessage({
      config: { ...DEFAULT_VIRTUAL_LOVER_CONFIG, proactive: { ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive, enabled: true } },
      api: createApi(),
      bundle: createBundle(),
      agentId: 'default',
      text: 'hello',
    });

    expect(result).toMatchObject({ ok: false, sent: false, error: 'virtual-lover.enabled 为 false' });
  });

  it('直接文本发送会调用 delivery.registry', async () => {
    const api = createApi();
    const sendText = vi.fn(async () => ({ ok: true, platform: 'telegram', messageId: '1' }));
    api.__services.set('delivery.registry', { sendText });

    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        target: { kind: 'chat' as const, id: '123' },
      },
    };

    const result = await sendProactiveMessage({
      config,
      api,
      bundle: createBundle(),
      agentId: 'default',
      text: 'hello proactive',
    });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(sendText).toHaveBeenCalledWith({
      platform: 'telegram',
      target: { kind: 'chat', id: '123' },
      text: 'hello proactive',
      metadata: { source: 'virtual-lover.proactive', agentId: 'default' },
    });
  });

  it('配置 binding 时优先调用 sendTextToBinding，不要求 target.id', async () => {
    const api = createApi();
    const sendTextToBinding = vi.fn(async () => ({ ok: true, platform: 'telegram', messageId: 'binding-msg' }));
    const sendText = vi.fn();
    api.__services.set('delivery.registry', { sendText, sendTextToBinding });

    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        binding: 'lover-main',
        policy: 'lover-default',
        target: { kind: 'chat' as const, id: '' },
      },
    };

    const result = await sendProactiveMessage({
      config,
      api,
      bundle: createBundle(),
      agentId: 'default',
      text: 'hello binding',
    });

    expect(result).toMatchObject({ ok: true, sent: true, text: 'hello binding' });
    expect(sendTextToBinding).toHaveBeenCalledWith({
      binding: 'lover-main',
      text: 'hello binding',
      policyId: 'lover-default',
      metadata: { source: 'virtual-lover.proactive', agentId: 'default' },
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('dryRun 生成消息但不调用 delivery.registry', async () => {
    const api = createApi();
    const sendText = vi.fn();
    api.__services.set('delivery.registry', { sendText });

    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        target: { kind: 'chat' as const, id: '123' },
      },
    };

    const result = await sendProactiveMessage({
      config,
      api,
      bundle: createBundle(),
      agentId: 'default',
      reason: 'user may need a gentle check-in',
      dryRun: true,
      now: new Date('2026-04-29T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ ok: true, sent: false, dryRun: true, text: 'Generated proactive message.' });
    expect(api.router.chat).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('生成主动消息时 lover memory 不可用也不应阻断生成', async () => {
    const api = createApi();
    api.__services.set('memory.spaces', {
      getOrCreateSpace: () => ({
        buildContext: async () => { throw new Error('memory disabled'); },
      }),
    });
    api.__services.set('delivery.registry', { sendText: vi.fn() });

    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        target: { kind: 'chat' as const, id: '123' },
      },
    };

    const result = await sendProactiveMessage({
      config,
      api,
      bundle: createBundle(),
      agentId: 'default',
      reason: 'memory service temporarily unavailable',
      dryRun: true,
      now: new Date('2026-04-29T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      sent: false,
      dryRun: true,
      text: 'Generated proactive message.',
    });
  });

  it('生成主动消息时会注入通用 environment context', async () => {
    const api = createApi();
    api.__services.set('environment.context', {
      buildContext: vi.fn(async () => ({ text: '今天有小雨，气温偏低。', source: 'test-weather' })),
    });
    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      proactive: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.proactive,
        enabled: true,
        target: { kind: 'chat' as const, id: '123' },
      },
    };

    const result = await sendProactiveMessage({
      config,
      api,
      bundle: createBundle(),
      agentId: 'default',
      reason: '结合天气发一条关心',
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(api.router.chat).toHaveBeenCalledOnce();
    const request = api.router.chat.mock.calls[0][0];
    expect(request.contents[0].parts[0].text).toContain('今天有小雨，气温偏低。');
  });

  it('virtual_lover_proactive_send 工具复用 proactive 发送逻辑', async () => {
    const api = createApi();
    const sendTextToBinding = vi.fn(async () => ({ ok: true, platform: 'telegram', messageId: 'tool-msg' }));
    api.__services.set('delivery.registry', { sendTextToBinding });

    const ctx = {
      readConfigSection: vi.fn(() => ({
        enabled: true,
        proactive: {
          enabled: true,
          binding: 'lover-main',
        },
      })),
      getDataDir: vi.fn(() => ''),
      getExtensionRootDir: vi.fn(() => undefined),
    } as any;

    const tool = createVirtualLoverProactiveTool(ctx, api);
    expect(tool.declaration.name).toBe(VIRTUAL_LOVER_PROACTIVE_TOOL_NAME);

    const result = await tool.handler({ text: 'hello from tool' });

    expect(result).toMatchObject({ ok: true, sent: true, text: 'hello from tool' });
    expect(sendTextToBinding).toHaveBeenCalledWith({
      binding: 'lover-main',
      text: 'hello from tool',
      metadata: { source: 'virtual-lover.proactive', agentId: 'default' },
    });
  });

  it('virtual_lover_proactive_send dryRun 不调用 delivery', async () => {
    const api = createApi();
    const sendText = vi.fn();
    api.__services.set('delivery.registry', { sendText });
    const ctx = {
      readConfigSection: vi.fn(() => ({ enabled: true, proactive: { enabled: true } })),
      getDataDir: vi.fn(() => ''),
      getExtensionRootDir: vi.fn(() => undefined),
    } as any;

    const tool = createVirtualLoverProactiveTool(ctx, api);
    const result = await tool.handler({ reason: 'test dry run', dryRun: true });
    expect(result).toMatchObject({ ok: true, sent: false, dryRun: true, text: 'Generated proactive message.' });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('virtual_lover_schedule_proactive dryRun 返回 cron 创建 payload', async () => {
    const api = createApi({ tools: { execute: vi.fn() } });
    const tool = createVirtualLoverScheduleProactiveTool(api);
    expect(tool.declaration.name).toBe(VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME);

    const result = await tool.handler({ template: 'goodnight_daily', dryRun: true });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      template: 'goodnight_daily',
      payload: {
        action: 'create',
        schedule_type: 'cron',
        schedule_value: '0 23 * * *',
        silent: true,
        allowed_tools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
      },
    });
    expect((result as any).payload.instruction).toContain(VIRTUAL_LOVER_PROACTIVE_TOOL_NAME);
    expect(api.tools.execute).not.toHaveBeenCalled();
  });

  it('virtual_lover_schedule_proactive 调用 manage_scheduled_tasks 创建任务', async () => {
    const execute = vi.fn(async () => ({ success: true, job: { id: 'job1' } }));
    const api = createApi({ tools: { execute } });
    const tool = createVirtualLoverScheduleProactiveTool(api);

    const result = await tool.handler({ template: 'test_30s', reason: '测试调度' });

    expect(result).toMatchObject({ ok: true, template: 'test_30s' });
    expect(execute).toHaveBeenCalledWith('manage_scheduled_tasks', expect.objectContaining({
      action: 'create',
      name: 'Virtual Lover 测试主动消息',
      schedule_type: 'once',
      schedule_value: '30s',
      silent: true,
      allowed_tools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
    }));
  });

  it('virtual_lover_schedule_proactive 优先使用 scheduler service 创建任务', async () => {
    const api = createApi({ tools: { execute: vi.fn() } });
    const createJob = vi.fn(async () => ({ id: 'svc-job', name: 'svc' }));
    api.__services.set(SCHEDULER_SERVICE_ID, { createJob });
    const tool = createVirtualLoverScheduleProactiveTool(api);

    const result = await tool.handler({ template: 'test_30s' });

    expect(result).toMatchObject({ ok: true, via: SCHEDULER_SERVICE_ID, job: { id: 'svc-job' } });
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Virtual Lover 测试主动消息',
      schedule: expect.objectContaining({ type: 'once' }),
      silent: true,
      allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
    }));
    expect(api.tools.execute).not.toHaveBeenCalled();
  });
});
