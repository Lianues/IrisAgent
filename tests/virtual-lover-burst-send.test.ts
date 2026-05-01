import { describe, expect, it, vi } from 'vitest';
import { createVirtualLoverBurstSendTool, VIRTUAL_LOVER_BURST_SEND_TOOL_NAME } from '../extensions/virtual-lover/src/burst-send-tool.js';

function createApi() {
  const services = new Map<string, unknown>();
  return {
    services: { get: vi.fn((id: string) => services.get(id)) },
    __services: services,
  } as any;
}

describe('virtual-lover burst send', () => {
  it('dryRun 返回将要连续发送的消息', async () => {
    const api = createApi();
    const ctx = { readConfigSection: vi.fn(() => ({ enabled: true, proactive: { enabled: true, binding: 'lover-main' } })) } as any;
    const tool = createVirtualLoverBurstSendTool(ctx, api);

    expect(tool.declaration.name).toBe(VIRTUAL_LOVER_BURST_SEND_TOOL_NAME);
    const result = await tool.handler({ text: '第一条\n第二条', dryRun: true });

    expect(result).toEqual({ ok: true, dryRun: true, messages: ['第一条', '第二条'], intervalMs: 1200 });
  });

  it('通过 delivery binding 连续发送多条消息，只有第一条应用 policy', async () => {
    const api = createApi();
    const sendTextToBinding = vi.fn(async () => ({ ok: true, platform: 'telegram' }));
    api.__services.set('delivery.registry', { sendTextToBinding });
    const ctx = { readConfigSection: vi.fn(() => ({
      enabled: true,
      proactive: { enabled: true, binding: 'lover-main', policy: 'lover-default' },
    })) } as any;
    const tool = createVirtualLoverBurstSendTool(ctx, api);

    const result = await tool.handler({ messages: ['第一条', '第二条'], intervalMs: 0 });

    expect(result).toMatchObject({ ok: true, sentCount: 2 });
    expect(sendTextToBinding).toHaveBeenNthCalledWith(1, expect.objectContaining({
      binding: 'lover-main',
      text: '第一条',
      policyId: 'lover-default',
    }));
    expect(sendTextToBinding).toHaveBeenNthCalledWith(2, expect.objectContaining({
      binding: 'lover-main',
      text: '第二条',
      policyId: undefined,
    }));
  });
});
