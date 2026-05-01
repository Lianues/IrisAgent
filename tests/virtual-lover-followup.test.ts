import { describe, expect, it, vi } from 'vitest';
import { SCHEDULER_SERVICE_ID } from 'irises-extension-sdk';
import { createVirtualLoverFollowupTool, scheduleVirtualLoverFollowup, VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME } from '../extensions/virtual-lover/src/followup.js';

class TestStore {
  constructor(private data = new Map<string, unknown>(), private prefix = '') {}
  get<T = unknown>(key: string): T | undefined { return this.data.get(this.prefix + key) as T | undefined; }
  set(key: string, value: unknown): void { this.data.set(this.prefix + key, value); }
  delete(key: string): boolean { return this.data.delete(this.prefix + key); }
  has(key: string): boolean { return this.data.has(this.prefix + key); }
  keys(): string[] { return Array.from(this.data.keys()).filter(k => k.startsWith(this.prefix)).map(k => k.slice(this.prefix.length)); }
  getAll(): Record<string, unknown> { const out: Record<string, unknown> = {}; for (const key of this.keys()) out[key] = this.get(key); return out; }
  setMany(entries: Record<string, unknown>): void { for (const [key, value] of Object.entries(entries)) this.set(key, value); }
  onChange() { return { dispose() {} }; }
  onAnyChange() { return { dispose() {} }; }
  agent(name: string) { return new TestStore(this.data, `${this.prefix}@a.${name}.`); }
  session(id: string) { return new TestStore(this.data, `${this.prefix}@s.${id}.`); }
  namespace(prefix: string) { return new TestStore(this.data, `${this.prefix}${prefix}.`); }
}

function createApi() {
  const scheduler = {
    createJob: vi.fn(async (input: any) => ({ id: 'job-1', ...input })),
  };
  return {
    scheduler,
    api: {
      globalStore: new TestStore(),
      agentManager: { getActiveSessionId: () => 'session-1' },
      services: { get: vi.fn((id: string) => id === SCHEDULER_SERVICE_ID ? scheduler : undefined) },
    } as any,
  };
}

describe('virtual-lover followup/deferredReply', () => {
  it('创建 followup once scheduler job 并写入 globalStore intent', async () => {
    const { api, scheduler } = createApi();
    const ctx = { readConfigSection: vi.fn(() => ({ enabled: true, proactive: { enabled: true, followup: { enabled: true, defaultDelayMinutes: 60, dedupeHours: 24 } } })) } as any;

    const result = await scheduleVirtualLoverFollowup(ctx, api, {
      reason: '明天面试后轻轻关心结果',
      delay: '2h',
      dedupeKey: 'interview-followup',
    });

    expect(result.ok).toBe(true);
    expect(result.intent?.jobId).toBe('job-1');
    expect(scheduler.createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringContaining('[virtual-lover:followup:'),
      schedule: expect.objectContaining({ type: 'once' }),
      sessionId: 'session-1',
      allowedTools: ['virtual_lover_proactive_send'],
    }));
    const stored = api.globalStore.namespace('virtual-lover').namespace('followups').get(result.intent!.id) as any;
    expect(stored.reason).toBe('明天面试后轻轻关心结果');
  });

  it('dedupeKey 在窗口内会跳过重复 followup', async () => {
    const { api } = createApi();
    const ctx = { readConfigSection: vi.fn(() => ({ enabled: true, proactive: { enabled: true, followup: { enabled: true, defaultDelayMinutes: 60, dedupeHours: 24 } } })) } as any;

    const first = await scheduleVirtualLoverFollowup(ctx, api, { reason: '同一事件', dedupeKey: 'same' });
    const second = await scheduleVirtualLoverFollowup(ctx, api, { reason: '同一事件', dedupeKey: 'same' });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, skipped: true });
    expect(second.intent?.id).toBe(first.intent?.id);
  });

  it('工具注册名称正确并支持 deferred_reply', async () => {
    const { api, scheduler } = createApi();
    const ctx = { readConfigSection: vi.fn(() => ({ enabled: true, proactive: { enabled: true, deferredReply: { enabled: true, defaultDelayMinutes: 15 } } })) } as any;
    const tool = createVirtualLoverFollowupTool(ctx, api);

    expect(tool.declaration.name).toBe(VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME);
    const result = await tool.handler({ mode: 'deferred_reply', reason: '稍后自然接话', delayMinutes: 5 });
    expect(result).toMatchObject({ ok: true });
    expect(scheduler.createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringContaining('[virtual-lover:deferred_reply:'),
    }));
  });
});
