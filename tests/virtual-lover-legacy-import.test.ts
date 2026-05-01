import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createVirtualLoverLegacyImportTool, VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME } from '../extensions/virtual-lover/src/legacy-import-tool.js';

function createCtx(dataDir: string) {
  return {
    getDataDir: vi.fn(() => dataDir),
    getExtensionRootDir: vi.fn(() => undefined),
    readConfigSection: vi.fn(() => ({
      enabled: true,
      agent: { defaultAgentId: 'default' },
      memory: { space: 'virtual-lover' },
      proactive: { binding: 'lover-main', strategies: { goodnight: { enabled: true, schedule: '0 23 * * *' } } },
    })),
  } as any;
}

function createApi() {
  const services = new Map<string, unknown>();
  const updateEditableConfig = vi.fn((payload: any) => ({ mergedRaw: payload }));
  const applyRuntimeConfigReload = vi.fn(async () => undefined);
  return {
    services,
    api: {
      services: { get: vi.fn((id: string) => services.get(id)) },
      configManager: {
        readEditableConfig: vi.fn(() => ({
          virtual_lover: {
            enabled: true,
            proactive: {
              strategies: {
                goodnight: { enabled: true, schedule: '0 23 * * *', reason: 'existing' },
              },
            },
          },
        })),
        updateEditableConfig,
        applyRuntimeConfigReload,
      },
    } as any,
    updateEditableConfig,
    applyRuntimeConfigReload,
  };
}

describe('virtual-lover legacy import', () => {
  it('dryRun 扫描旧 prompt/memory/target 但不写入', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-lover-src-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-lover-data-'));
    try {
      fs.writeFileSync(path.join(sourceDir, 'persona.md'), '# 旧人设', 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'memory.json'), JSON.stringify([{ content: '用户喜欢安静的晚安。', type: 'user' }]), 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'config.json'), JSON.stringify({ telegram: { chatId: '12345' } }), 'utf-8');
      const { api, updateEditableConfig } = createApi();
      const tool = createVirtualLoverLegacyImportTool(createCtx(dataDir), api);

      expect(tool.declaration.name).toBe(VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME);
      const result = await tool.handler({ sourcePath: sourceDir });

      expect(result).toMatchObject({ ok: true, report: { dryRun: true } });
      expect((result as any).report.prompt.found.length).toBeGreaterThan(0);
      expect((result as any).report.memory.found).toBe(1);
      expect((result as any).report.delivery.targetId).toBe('12345');
      expect(updateEditableConfig).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('执行迁移时写入 prompt、memory、delivery，并深合并策略配置', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-lover-src-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-lover-data-'));
    try {
      fs.writeFileSync(path.join(sourceDir, 'persona.md'), '# 旧人设', 'utf-8');
      fs.mkdirSync(path.join(sourceDir, 'prompt'));
      fs.writeFileSync(path.join(sourceDir, 'prompt', 'style.md'), '# 旧风格', 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'prompt', 'rules.md'), '# 旧边界', 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'memory.json'), JSON.stringify([{ content: '用户喜欢安静的晚安。', type: 'user', name: 'goodnight' }]), 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'config.json'), JSON.stringify({
        telegram: { chatId: '12345' },
        proactive: { strategies: { random: { enabled: true } } },
      }), 'utf-8');
      const { api, services, updateEditableConfig, applyRuntimeConfigReload } = createApi();
      const add = vi.fn(async () => 1);
      services.set('memory.spaces', { getOrCreateSpace: vi.fn(() => ({ add })) });
      const tool = createVirtualLoverLegacyImportTool(createCtx(dataDir), api);

      const result = await tool.handler({ sourcePath: sourceDir, dryRun: false, overwritePrompt: true, policyId: 'lover-default' });

      expect(result).toMatchObject({ ok: true, report: { dryRun: false } });
      expect(fs.readFileSync(path.join(dataDir, 'agents', 'default', 'prompt', 'persona.md'), 'utf-8')).toContain('旧人设');
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ content: '用户喜欢安静的晚安。' }));
      expect(updateEditableConfig).toHaveBeenCalledOnce();
      const payload = updateEditableConfig.mock.calls[0][0];
      expect(payload.delivery.bindings['lover-main'].target.id).toBe('12345');
      expect(payload.virtual_lover.proactive.strategies.goodnight).toMatchObject({ enabled: true, schedule: '0 23 * * *' });
      expect(payload.virtual_lover.proactive.strategies.random).toMatchObject({ enabled: true });
      expect(applyRuntimeConfigReload).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
