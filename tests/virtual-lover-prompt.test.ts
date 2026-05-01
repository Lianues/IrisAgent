import { describe, expect, it } from 'vitest';
import { DEFAULT_VIRTUAL_LOVER_CONFIG, parseVirtualLoverConfig } from '../extensions/virtual-lover/src/config.js';
import { buildVirtualLoverPrompt } from '../extensions/virtual-lover/src/prompt/builder.js';
import { applyVirtualLoverSystemPrompt } from '../extensions/virtual-lover/src/prompt/system.js';
import type { PromptBundleSnapshot } from '../extensions/virtual-lover/src/state.js';

describe('virtual-lover prompt MVP', () => {
  it('默认配置不启用 prompt 注入，避免自动发现后改变 Iris 行为', () => {
    expect(parseVirtualLoverConfig().enabled).toBe(false);
  });

  it('默认引用独立 lover memory space，而不是自建私有记忆文件', () => {
    const config = parseVirtualLoverConfig();
    expect(config.memory).toMatchObject({
      space: 'virtual-lover',
      autoInject: true,
      maxRecallBytes: 12000,
      autoExtract: true,
      extractInterval: 1,
      tools: { enabled: true },
    });
    expect(config.prompt.sections).toEqual(['persona', 'style', 'rules', 'lover_memory']);
  });

  it('构建 prompt 时组合 companion prompt fragments 和 lover memory context', () => {
    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      prompt: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.prompt,
        useAntml: false,
        sections: ['persona', 'style', 'rules', 'lover_memory'],
      },
    };

    const bundle: PromptBundleSnapshot = createBundle();

    const result = buildVirtualLoverPrompt({
      agentId: 'default',
      now: new Date('2026-04-28T00:00:00.000Z'),
      config,
      bundle,
      loverMemoryContext: 'Lover memory: user likes quiet goodnight messages.',
    });

    expect(result.systemText).toContain('Persona content');
    expect(result.systemText).toContain('Style content');
    expect(result.systemText).toContain('Rules content');
    expect(result.systemText).toContain('Lover memory: user likes quiet goodnight messages.');
    expect(result.systemText).toContain('独立 memory space: virtual-lover');
    expect(result.systemText).not.toContain('STATE');
    expect(result.systemText).not.toContain('RECENT_MEMORY');
    expect(result.diagnostics).toEqual([]);
  });

  it('没有 lover memory context 时只禁用 lover_memory section，不影响 persona/style/rules', () => {
    const result = buildVirtualLoverPrompt({
      agentId: 'default',
      now: new Date('2026-04-28T00:00:00.000Z'),
      config: { ...DEFAULT_VIRTUAL_LOVER_CONFIG, enabled: true },
      bundle: createBundle(),
    });

    expect(result.systemText).toContain('Persona content');
    expect(result.sections.find((section) => section.id === 'lover_memory')?.enabled).toBe(false);
    expect(result.sections.find((section) => section.id === 'lover_memory')?.reason).toContain('lover memory space 当前没有可注入内容');
  });

  it('旧配置残留的 private memory sections 会被跳过并提示改用 lover memory space', () => {
    const config = {
      ...DEFAULT_VIRTUAL_LOVER_CONFIG,
      enabled: true,
      prompt: {
        ...DEFAULT_VIRTUAL_LOVER_CONFIG.prompt,
        useAntml: false,
        sections: ['persona', 'state', 'recent_memory', 'memory'],
      },
    };

    const result = buildVirtualLoverPrompt({
      agentId: 'default',
      now: new Date('2026-04-28T00:00:00.000Z'),
      config,
      bundle: createBundle(),
    });

    expect(result.systemText).toContain('Persona content');
    expect(result.diagnostics).toEqual([
      '已跳过旧 section "state"：lover 记忆应来自 Iris memory space "virtual-lover"，不再由 virtual-lover 私有文件注入。',
      '已跳过旧 section "recent_memory"：lover 记忆应来自 Iris memory space "virtual-lover"，不再由 virtual-lover 私有文件注入。',
      '已跳过旧 section "memory"：lover 记忆应来自 Iris memory space "virtual-lover"，不再由 virtual-lover 私有文件注入。',
    ]);
  });

  it('prepend/replace 注入不会原地修改原始 LLMRequest', () => {
    const request = {
      contents: [],
      systemInstruction: {
        parts: [{ text: 'Iris core prompt' }],
      },
    };

    const prepended = applyVirtualLoverSystemPrompt(request, 'Virtual lover prompt', 'prepend');
    expect(prepended).not.toBe(request);
    expect(prepended.systemInstruction.parts.map((part) => 'text' in part ? part.text : '')).toEqual([
      'Virtual lover prompt',
      'Iris core prompt',
    ]);
    expect(request.systemInstruction.parts).toEqual([{ text: 'Iris core prompt' }]);

    const replaced = applyVirtualLoverSystemPrompt(request, 'Virtual lover prompt', 'replace');
    expect(replaced.systemInstruction.parts).toEqual([{ text: 'Virtual lover prompt' }]);
  });
});

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
