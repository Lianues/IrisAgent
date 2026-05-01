import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../extensions/memory/src/config.js';
import { createMemorySpacesService } from '../extensions/memory/src/service.js';

describe('memory.spaces service', () => {
  it('为不同 space 使用独立存储并支持按 space recall', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-memory-spaces-'));
    try {
      const config = resolveConfig({
        spaces: {
          'virtual-lover': { enabled: true, dbPath: 'spaces/virtual-lover/memory.db' },
          main: { enabled: true, dbPath: 'spaces/main/memory.db' },
        },
      }, undefined);

      const service = createMemorySpacesService({
        api: { router: {} } as any,
        dataDir: tmpDir,
        config,
        logger: { info() {}, warn() {} },
      });

      const lover = service.getOrCreateSpace('virtual-lover');
      const main = service.getOrCreateSpace('main');

      await lover.add({
        type: 'user',
        name: 'goodnight_preference',
        description: 'User likes quiet goodnight messages',
        content: 'User likes quiet goodnight messages from the virtual lover.',
      });
      await main.add({
        type: 'project',
        name: 'project_pref',
        description: 'Main project preference',
        content: 'Main memory should stay outside lover memory.',
      });

      expect(await lover.count()).toBe(1);
      expect(await main.count()).toBe(1);

      const loverSearch = await lover.search('goodnight');
      const mainSearch = await main.search('goodnight');
      expect(loverSearch.map((item) => item.name)).toEqual(['goodnight_preference']);
      expect(mainSearch).toEqual([]);

      const context = await lover.buildContext({ userText: 'Can you say goodnight?', maxBytes: 4096 });
      expect(context?.text).toContain('User likes quiet goodnight messages');
      expect(context?.ids).toEqual([]);
      expect(context?.userIds).toEqual([1]);

      expect(fs.existsSync(path.join(tmpDir, 'spaces', 'virtual-lover', 'memory.db'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'spaces', 'main', 'memory.db'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('getSpace 对未配置或禁用的 space 返回 undefined，getOrCreateSpace 可按默认配置创建', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-memory-spaces-'));
    try {
      const config = resolveConfig({
        spaces: {
          disabled: { enabled: false },
        },
      }, undefined);

      const service = createMemorySpacesService({
        api: { router: {} } as any,
        dataDir: tmpDir,
        config,
        logger: { info() {}, warn() {} },
      });

      expect(service.getSpace('missing')).toBeUndefined();
      expect(service.getSpace('disabled')).toBeUndefined();

      const created = service.getOrCreateSpace('on-demand');
      const id = await created.add({ content: 'On demand space memory.', type: 'reference' });
      expect(id).toBe(1);
      expect(await created.count()).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updateConfig 会更新已创建 space 的模型配置和存储路径', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-memory-spaces-'));
    try {
      const service = createMemorySpacesService({
        api: { router: {} } as any,
        dataDir: tmpDir,
        config: resolveConfig({
          model: 'model-a',
          spaces: {
            lover: { enabled: true, dbPath: 'spaces/a/memory.db' },
          },
        }, undefined),
        logger: { info() {}, warn() {} },
      });

      const lover = service.getOrCreateSpace('lover');
      await lover.add({ content: 'First path memory.', type: 'reference' });
      expect(lover.dbPath.endsWith(path.join('spaces', 'a', 'memory.db'))).toBe(true);

      service.updateConfig(resolveConfig({
        model: 'model-b',
        spaces: {
          lover: { enabled: true, dbPath: 'spaces/b/memory.db' },
        },
      }, undefined));

      expect(lover.dbPath.endsWith(path.join('spaces', 'b', 'memory.db'))).toBe(true);
      expect(await lover.count()).toBe(0);
      await lover.add({ content: 'Second path memory.', type: 'reference' });
      expect(await lover.count()).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, 'spaces', 'a', 'memory.db'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'spaces', 'b', 'memory.db'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('extractFromSession 会将提取结果写入指定 space', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-memory-spaces-'));
    try {
      const config = resolveConfig({
        spaces: {
          lover: { enabled: true, dbPath: 'spaces/lover/memory.db' },
        },
      }, undefined);
      const api = {
        storage: {
          getHistory: async () => ([
            { role: 'user', parts: [{ text: '我喜欢睡前收到安静的晚安消息。' }] },
            { role: 'model', parts: [{ text: '我会记得用轻一点的方式陪你说晚安。' }] },
          ]),
        },
        router: {
          chat: async () => ({
            content: {
              parts: [{
                functionCall: {
                  name: 'memory_add',
                  args: {
                    content: 'User likes quiet goodnight messages before sleep.',
                    name: 'quiet_goodnight_preference',
                    description: 'Goodnight message preference',
                    type: 'user',
                  },
                },
              }],
            },
          }),
        },
      } as any;
      const service = createMemorySpacesService({ api, dataDir: tmpDir, config, logger: { info() {}, warn() {} } });
      const lover = service.getOrCreateSpace('lover');

      const result = await lover.extractFromSession({ sessionId: 's1' });
      expect(result).toMatchObject({ ok: true, savedCount: 1 });
      const memories = await lover.search('goodnight');
      expect(memories.map((memory) => memory.name)).toEqual(['quiet_goodnight_preference']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
