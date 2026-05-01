import type { VirtualLoverConfig } from '../config.js';
import type { PromptBundleSnapshot } from '../state.js';
import { renderAntmlDocument, renderMarkdownDocument, type RenderablePromptSection } from './antml.js';

export interface BuildPromptInput {
  agentId: string;
  sessionId?: string;
  now: Date;
  config: VirtualLoverConfig;
  bundle: PromptBundleSnapshot;
  /** 来自 Iris memory extension 中 virtual-lover space 的 recall 结果 */
  loverMemoryContext?: string;
  existingSystemInstruction?: unknown;
}

export interface PromptSectionResult extends RenderablePromptSection {
  enabled: boolean;
  reason?: string;
}

export interface BuildPromptResult {
  systemText: string;
  sections: PromptSectionResult[];
  diagnostics: string[];
}

const SECTION_TITLES: Record<string, string> = {
  persona: '伴侣人设',
  style: '表达风格',
  rules: '行为边界',
  lover_memory: '伴侣记忆',
};

const LEGACY_PRIVATE_MEMORY_SECTION_IDS = new Set(['state', 'recent_memory', 'recent', 'memory', 'long_term_memory']);

export function buildVirtualLoverPrompt(input: BuildPromptInput): BuildPromptResult {
  const diagnostics: string[] = [];
  const sections: PromptSectionResult[] = [];

  for (const sectionId of input.config.prompt.sections) {
    const resolved = resolveSectionContent(sectionId, input, diagnostics);
    if (!resolved) continue;

    const content = resolved.content.trim();
    const enabled = resolved.enabled && content.length > 0;
    sections.push({
      id: sectionId,
      title: resolved.title,
      content,
      enabled,
      reason: enabled ? undefined : resolved.reason ?? '内容为空或未启用',
    });
  }

  const activeSections = sections.filter((section) => section.enabled);
  if (activeSections.length === 0) {
    diagnostics.push('没有可注入的 virtual-lover prompt section');
    return { systemText: '', sections, diagnostics };
  }

  const body = input.config.prompt.useAntml
    ? renderAntmlDocument(activeSections)
    : renderMarkdownDocument(activeSections);

  const header = [
    '你正在使用 Iris 的 virtual-lover extension。以下内容是该 extension 提供的伴侣表达上下文。',
    `伴侣记忆来自 Iris memory extension 的独立 memory space: ${input.config.memory.space}`,
    `Agent: ${input.agentId}`,
    `GeneratedAt: ${input.now.toISOString()}`,
  ].join('\n');

  return {
    systemText: `${header}\n\n${body}`.trim(),
    sections,
    diagnostics,
  };
}

function resolveSectionContent(
  sectionId: string,
  input: BuildPromptInput,
  diagnostics: string[],
): { title: string; content: string; enabled: boolean; reason?: string } | undefined {
  const title = SECTION_TITLES[sectionId] ?? sectionId;

  switch (sectionId) {
    case 'persona':
      return { title, content: input.bundle.fragments.persona, enabled: true };
    case 'style':
      return { title, content: input.bundle.fragments.style, enabled: true };
    case 'rules':
      return { title, content: input.bundle.fragments.rules, enabled: true };
    case 'lover_memory':
      return {
        title,
        content: input.config.memory.autoInject ? input.loverMemoryContext ?? '' : '',
        enabled: input.config.memory.autoInject && Boolean(input.loverMemoryContext?.trim()),
        reason: input.config.memory.autoInject
          ? 'lover memory space 当前没有可注入内容，或 memory.spaces service 不可用'
          : 'memory.autoInject 为 false',
      };
    default:
      if (LEGACY_PRIVATE_MEMORY_SECTION_IDS.has(sectionId)) {
        diagnostics.push(`已跳过旧 section "${sectionId}"：lover 记忆应来自 Iris memory space "${input.config.memory.space}"，不再由 virtual-lover 私有文件注入。`);
      } else {
        diagnostics.push(`未知 prompt section: ${sectionId}`);
      }
      return undefined;
  }
}
