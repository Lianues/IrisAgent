import { describe, expect, it, vi } from 'vitest';
import { DeliveryRegistry } from '../src/extension/delivery-registry.js';
import { parseDeliveryConfig } from '../src/config/delivery.js';
import type { PlatformDeliveryProvider } from 'irises-extension-sdk';

function createProvider(platform = 'demo'): PlatformDeliveryProvider {
  return {
    platform,
    capabilities: { text: true },
    sendText: vi.fn(async ({ text }) => ({ ok: true, platform, messageId: `msg:${text}` })),
  };
}

describe('delivery registry', () => {
  it('解析 delivery.yaml bindings 配置', () => {
    expect(parseDeliveryConfig({
      bindings: {
        'lover-main': {
          label: 'Lover Main',
          platform: 'Telegram',
          target: { kind: 'chat', id: '123', threadId: '9' },
          enabled: true,
        },
      },
      policies: {
        'lover-default': {
          cooldownMinutes: 180,
          maxPerDay: 3,
          quietHours: {
            enabled: true,
            windows: [{ start: '23:30', end: '07:30' }],
          },
        },
      },
    })).toEqual({
      bindings: [{
        id: 'lover-main',
        label: 'Lover Main',
        platform: 'telegram',
        target: { kind: 'chat', id: '123', accountId: undefined, threadId: '9', raw: undefined },
        defaultSessionId: undefined,
        enabled: true,
        metadata: undefined,
        policyId: undefined,
      }],
      policies: [{
        id: 'lover-default',
        label: undefined,
        enabled: true,
        cooldownMinutes: 180,
        maxPerDay: 3,
        quietHours: {
          enabled: true,
          windows: [{ start: '23:30', end: '07:30' }],
          allowUrgent: false,
        },
        skipIfRecentActivity: undefined,
        metadata: undefined,
      }],
    });
  });

  it('注册 provider 后可路由 sendText，并可注销', async () => {
    const registry = new DeliveryRegistry();
    const provider = createProvider('demo');
    const disposable = registry.registerProvider(provider);

    expect(registry.listProviders()).toEqual([{ platform: 'demo', capabilities: { text: true } }]);

    const result = await registry.sendText({
      platform: 'demo',
      target: { kind: 'chat', id: '42' },
      text: 'hello',
    });

    expect(result).toEqual({ ok: true, platform: 'demo', messageId: 'msg:hello' });
    expect(provider.sendText).toHaveBeenCalledWith({
      target: { kind: 'chat', id: '42' },
      text: 'hello',
      sessionId: undefined,
      metadata: undefined,
    });

    disposable.dispose();
    expect(registry.getProvider('demo')).toBeUndefined();
  });

  it('重复注册同平台 provider 时后注册者覆盖，旧 disposable 不会删除新 provider', async () => {
    const registry = new DeliveryRegistry();
    const first = createProvider('demo');
    const second = createProvider('demo');
    const firstDisposable = registry.registerProvider(first);
    registry.registerProvider(second);

    firstDisposable.dispose();

    const result = await registry.sendText({
      platform: 'demo',
      target: { kind: 'chat', id: '42' },
      text: 'new',
    });

    expect(result.messageId).toBe('msg:new');
    expect(first.sendText).not.toHaveBeenCalled();
    expect(second.sendText).toHaveBeenCalledOnce();
  });

  it('未注册 provider 或 provider 抛错时返回失败结果', async () => {
    const registry = new DeliveryRegistry();

    await expect(registry.sendText({
      platform: 'missing',
      target: { kind: 'chat', id: '1' },
      text: 'hello',
    })).resolves.toEqual({ ok: false, platform: 'missing', error: '未注册 delivery provider: missing' });

    registry.registerProvider({
      platform: 'broken',
      capabilities: { text: true },
      sendText: async () => { throw new Error('boom'); },
    });

    await expect(registry.sendText({
      platform: 'broken',
      target: { kind: 'chat', id: '1' },
      text: 'hello',
    })).resolves.toEqual({ ok: false, platform: 'broken', error: 'boom' });
  });

  it('sendAttachment 在 provider 不支持附件时返回失败结果', async () => {
    const registry = new DeliveryRegistry();
    registry.registerProvider(createProvider('demo'));

    const result = await registry.sendAttachment({
      platform: 'demo',
      target: { kind: 'chat', id: '1' },
      attachment: { type: 'image', data: Buffer.from('x') },
    });

    expect(result).toEqual({ ok: false, platform: 'demo', error: 'delivery provider "demo" 不支持附件投递' });
  });

  it('支持 delivery binding 并通过 binding 发送文本', async () => {
    const registry = new DeliveryRegistry();
    const provider = createProvider('telegram');
    registry.registerProvider(provider);
    const disposable = registry.registerBinding({
      id: 'lover-main',
      label: 'Lover Main',
      platform: 'telegram',
      target: { kind: 'chat', id: '123' },
      defaultSessionId: 'telegram-dm-123',
      metadata: { owner: 'virtual-lover' },
    });

    expect(registry.getBinding('lover-main')).toMatchObject({
      id: 'lover-main',
      platform: 'telegram',
      target: { kind: 'chat', id: '123' },
    });

    const result = await registry.sendTextToBinding({
      binding: 'lover-main',
      text: 'hello binding',
      metadata: { source: 'test' },
    });

    expect(result).toMatchObject({ ok: true, platform: 'telegram', messageId: 'msg:hello binding' });
    expect(provider.sendText).toHaveBeenCalledWith({
      target: { kind: 'chat', id: '123' },
      text: 'hello binding',
      sessionId: 'telegram-dm-123',
      metadata: { owner: 'virtual-lover', source: 'test', binding: 'lover-main' },
    });

    disposable.dispose();
    expect(registry.getBinding('lover-main')).toBeUndefined();
  });

  it('禁用或缺失 binding 时返回失败结果', async () => {
    const registry = new DeliveryRegistry();
    registry.registerBinding({
      id: 'disabled',
      platform: 'telegram',
      target: { kind: 'chat', id: '123' },
      enabled: false,
    });

    await expect(registry.sendTextToBinding({ binding: 'missing', text: 'x' }))
      .resolves.toEqual({ ok: false, platform: '', error: '未注册 delivery binding: missing' });
    await expect(registry.sendTextToBinding({ binding: 'disabled', text: 'x' }))
      .resolves.toEqual({ ok: false, platform: 'telegram', error: 'delivery binding 已禁用: disabled' });
  });

  it('delivery policy 支持 cooldown、maxPerDay 与发送历史', async () => {
    const registry = new DeliveryRegistry();
    registry.registerProvider(createProvider('telegram'));
    registry.registerPolicy({ id: 'lover-default', cooldownMinutes: 60, maxPerDay: 1 });
    registry.registerBinding({
      id: 'lover-main',
      platform: 'telegram',
      target: { kind: 'chat', id: '123' },
      policyId: 'lover-default',
    });

    const first = await registry.sendTextToBinding({ binding: 'lover-main', text: 'first' });
    expect(first.ok).toBe(true);
    expect(registry.listSendRecords({ policyId: 'lover-default' })).toHaveLength(1);

    const second = await registry.sendTextToBinding({ binding: 'lover-main', text: 'second' });
    expect(second).toMatchObject({ ok: false, skipped: true, platform: 'telegram' });
    expect(second.error).toContain('冷却中');
  });

  it('delivery policy 支持 quietHours 和 recent activity 门控', async () => {
    const registry = new DeliveryRegistry();
    registry.registerPolicy({
      id: 'quiet',
      quietHours: { enabled: true, windows: [{ start: '00:00', end: '23:59' }], allowUrgent: false },
    });

    expect(registry.evaluatePolicy({ policyId: 'quiet', platform: 'telegram', target: { kind: 'chat', id: '1' } }))
      .toMatchObject({ allowed: false, skipped: true });
    expect(registry.evaluatePolicy({ policyId: 'quiet', platform: 'telegram', target: { kind: 'chat', id: '1' }, urgent: true }))
      .toMatchObject({ allowed: false, skipped: true });

    registry.registerPolicy({
      id: 'recent',
      skipIfRecentActivity: { enabled: true, withinMinutes: 10 },
    });
    registry.recordActivity({ platform: 'telegram', target: { kind: 'chat', id: '2' }, occurredAt: Date.now() });
    expect(registry.evaluatePolicy({ policyId: 'recent', platform: 'telegram', target: { kind: 'chat', id: '2' } }))
      .toMatchObject({ allowed: false, skipped: true });
    expect(registry.listRecentTargets({ platform: 'telegram' })[0]).toMatchObject({
      platform: 'telegram',
      target: { kind: 'chat', id: '2' },
    });

    const registryWithTelegramKindNormalization = new DeliveryRegistry();
    registryWithTelegramKindNormalization.registerPolicy({
      id: 'recent',
      skipIfRecentActivity: { enabled: true, withinMinutes: 10 },
    });
    registryWithTelegramKindNormalization.recordActivity({
      platform: 'telegram',
      target: { kind: 'user', id: '3' },
      occurredAt: Date.now(),
    });
    expect(registryWithTelegramKindNormalization.evaluatePolicy({ policyId: 'recent', platform: 'telegram', target: { kind: 'chat', id: '3' } }))
      .toMatchObject({ allowed: false, skipped: true });
  });
});
