import { describe, expect, it, vi } from 'vitest';
import { TelegramPlatform } from '../extensions/telegram/src/index.js';

class FakeBackend {
  on() { return this; }
  off() { return this; }
  isStreamEnabled() { return false; }
}

describe('telegram delivery attachment provider', () => {
  it('注册 image/audio/file 能力并通过 sendAttachment 发送图片', async () => {
    let provider: any;
    const registry = {
      registerProvider: vi.fn((p: any) => {
        provider = p;
        return { dispose() {} };
      }),
    };
    const api = { services: { get: vi.fn((id: string) => id === 'delivery.registry' ? registry : undefined) } } as any;
    const platform = new TelegramPlatform(new FakeBackend() as any, { token: 'bot-token' }, api);
    const sendPhoto = vi.fn(async () => 42);
    (platform as any).client = { sendText: vi.fn(), sendPhoto };

    (platform as any).registerDeliveryProvider();

    expect(provider.capabilities).toMatchObject({ text: true, image: true, audio: true, file: true });
    const result = await provider.sendAttachment({
      target: { kind: 'chat', id: '123' },
      attachment: { type: 'image', mimeType: 'image/png', data: Buffer.from('png') },
      caption: '图片说明',
    });

    expect(result).toMatchObject({ ok: true, platform: 'telegram', messageId: '42' });
    expect(sendPhoto).toHaveBeenCalledOnce();
  });
});
