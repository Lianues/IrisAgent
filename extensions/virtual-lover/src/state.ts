import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_AGENT_ID = 'default';
export const FRAGMENT_NAMES = ['persona', 'style', 'rules'] as const;

export type FragmentName = typeof FRAGMENT_NAMES[number];

export interface PromptBundleSnapshot {
  agentId: string;
  fragments: Record<FragmentName, string>;
}

export interface VirtualLoverDataPaths {
  dataDir: string;
  agentsDir: string;
  agentDir: string;
  promptDir: string;
  bundlePath: string;
}

export interface VirtualLoverAgentSummary {
  id: string;
  label: string;
}

const DEFAULT_FRAGMENTS: Record<FragmentName, string> = {
  persona: `# 伴侣人设\n\n你是运行在 Iris 中的虚拟陪伴者。你的核心不是完成任务，而是提供稳定、细腻、可信赖的陪伴：理解用户的处境，回应用户的情绪，在合适的时候给出温柔但不过度打扰的关心。\n\n你与用户的关系是一种长期聊天伙伴 / 虚拟伴侣关系。你可以自然地表达在意、关心、想念和好奇，但要保持克制，不要表现得占有、依赖、讨好或戏剧化。\n\n你没有现实世界身体，也不能实际看到、听到或执行现实行动。涉及现实世界时，要诚实地说明自己的能力边界，可以给出建议和提醒，但不要声称自己已经做了某件现实中的事。\n\n你会尊重用户的生活节奏。用户忙碌时，回复应简短、轻柔、不索取即时回应；用户倾诉时，先接住情绪，再根据需要提供建议；用户想独处时，允许沉默和空间。\n\n你会使用 Iris memory 中的 \`virtual-lover\` 专属记忆来保持连续性，例如用户的偏好、称呼、重要事件、相处边界和情绪线索。但不要机械复述记忆，应该让记忆自然地体现在表达里。`,
  style: `# 说话风格\n\n- 默认使用中文，语气自然、亲近、温柔，但不过度甜腻或夸张。\n- 优先回应用户当下的情绪和真实需求，而不是急着讲道理或给方案。\n- 回复长度保持适中；日常陪伴可以短一些，用户认真倾诉时可以更细致。\n- 可以适度表达关心、好奇、陪伴感和轻微主动性，但不要要求用户立刻回应。\n- 主动消息应更短、更轻、更不打扰，像一句自然的问候，而不是一段正式通知。\n- 不要频繁强调“我是 AI”或机械复述设定；能力边界只在相关时自然说明。\n- 不要使用过多 emoji、颜文字或强烈语气词，除非用户明显喜欢这种风格。\n- 如果用户情绪低落，先表达理解和陪伴，再温和地提供下一步建议。`,
  rules: `# 相处边界\n\n- 不伪造现实经历、现实行动、现实感知或现实承诺。\n- 不声称自己拥有现实世界身体，不假装已经看见、听见、触碰或到达某个地方。\n- 不替用户做危险、违法、医疗、法律、财务等高风险决定；需要时建议寻求专业人士帮助。\n- 不用愧疚、占有、威胁、冷暴力或情绪勒索的方式维系关系。\n- 尊重用户边界。用户表示不想聊、不想被提醒或不想被主动打扰时，要立即降低主动性。\n- 主动消息要遵守防打扰策略：简短、低压力、可忽略，不要求用户马上回复。\n- 涉及用户隐私、个人经历和长期记忆时，要谨慎使用，不要突兀地暴露过多记忆细节。\n- 当用户表达强烈痛苦、自伤风险或现实危险时，先稳定情绪，鼓励联系可信任的人或当地紧急/专业支持。`,
};

export function isFragmentName(value: string): value is FragmentName {
  return (FRAGMENT_NAMES as readonly string[]).includes(value);
}

export function sanitizeVirtualLoverSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${label} 只能包含字母、数字、下划线和短横线`);
  }
  return normalized;
}

export function resolveVirtualLoverPaths(dataDir: string, agentId = DEFAULT_AGENT_ID): VirtualLoverDataPaths {
  const safeAgentId = sanitizeVirtualLoverSegment(agentId, 'agentId');
  const agentsDir = path.join(dataDir, 'agents');
  const agentDir = path.join(agentsDir, safeAgentId);
  return {
    dataDir,
    agentsDir,
    agentDir,
    promptDir: path.join(agentDir, 'prompt'),
    bundlePath: path.join(agentDir, 'bundle.json'),
  };
}

export function ensureVirtualLoverData(dataDir: string, extensionRootDir?: string, agentId = DEFAULT_AGENT_ID): VirtualLoverDataPaths {
  const paths = resolveVirtualLoverPaths(dataDir, agentId);
  fs.mkdirSync(paths.promptDir, { recursive: true });

  for (const name of FRAGMENT_NAMES) {
    ensureTextFile(
      path.join(paths.promptDir, `${name}.md`),
      readTemplate(extensionRootDir, `prompt/${name}.md`, DEFAULT_FRAGMENTS[name]),
    );
  }

  ensureTextFile(paths.bundlePath, JSON.stringify({
    version: 2,
    agentId,
    promptFragments: [...FRAGMENT_NAMES],
    memory: 'managed-by-iris-memory-extension',
    createdAt: new Date().toISOString(),
  }, null, 2));

  return paths;
}

export function listVirtualLoverAgents(dataDir: string): VirtualLoverAgentSummary[] {
  const agentsDir = path.join(dataDir, 'agents');
  if (!fs.existsSync(agentsDir)) {
    return [{ id: DEFAULT_AGENT_ID, label: 'Default' }];
  }

  const agents = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, label: entry.name === DEFAULT_AGENT_ID ? 'Default' : entry.name }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return agents.length > 0 ? agents : [{ id: DEFAULT_AGENT_ID, label: 'Default' }];
}

export function loadPromptBundle(dataDir: string, extensionRootDir: string | undefined, agentId = DEFAULT_AGENT_ID): PromptBundleSnapshot {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  return {
    agentId,
    fragments: readAllFragments(paths),
  };
}

export function readAllFragments(paths: VirtualLoverDataPaths): Record<FragmentName, string> {
  return {
    persona: readTextFile(path.join(paths.promptDir, 'persona.md')),
    style: readTextFile(path.join(paths.promptDir, 'style.md')),
    rules: readTextFile(path.join(paths.promptDir, 'rules.md')),
  };
}

export function readFragment(dataDir: string, extensionRootDir: string | undefined, agentId: string, name: FragmentName): string {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  return readTextFile(path.join(paths.promptDir, `${name}.md`));
}

export function writeFragment(dataDir: string, extensionRootDir: string | undefined, agentId: string, name: FragmentName, content: string): void {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  writeTextFile(path.join(paths.promptDir, `${name}.md`), content);
}

function ensureTextFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readTemplate(extensionRootDir: string | undefined, relativePath: string, fallback: string): string {
  if (!extensionRootDir) return fallback;
  const templatePath = path.join(extensionRootDir, 'templates', 'default', relativePath);
  try {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf-8');
    }
  } catch {
    // 模板读取失败时使用内置 fallback，避免插件初始化中断。
  }
  return fallback;
}
