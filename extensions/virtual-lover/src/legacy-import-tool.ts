import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IrisAPI, PluginContext, ToolDefinition } from 'irises-extension-sdk';
import { loadPromptBundle, writeFragment, type FragmentName } from './state.js';
import { MEMORY_SPACES_SERVICE_ID, type MemorySpacesServiceLike } from './memory-tools.js';
import { parseVirtualLoverConfig } from './config.js';

export const VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME = 'virtual_lover_import_legacy';

interface ImportReport {
  sourcePath: string;
  dryRun: boolean;
  prompt: {
    found: string[];
    imported: string[];
    skipped: string[];
  };
  memory: {
    found: number;
    imported: number;
    skipped: number;
    reason?: string;
  };
  delivery: {
    bindingId?: string;
    targetId?: string;
    policyId?: string;
    imported: boolean;
  };
  config: {
    imported: boolean;
    strategyKeys: string[];
  };
  warnings: string[];
}

type MemoryCandidate = {
  content: string;
  name?: string;
  description?: string;
  type?: string;
};

const PROMPT_CANDIDATES: Record<FragmentName, string[]> = {
  persona: [
    'persona.md', 'prompt/persona.md', 'prompts/persona.md', 'character/persona.md', 'data/persona.md',
    'profile.md', 'character.md', 'system/persona.md',
  ],
  style: [
    'style.md', 'prompt/style.md', 'prompts/style.md', 'character/style.md', 'data/style.md',
    'tone.md', 'expression.md', 'speaking-style.md',
  ],
  rules: [
    'rules.md', 'prompt/rules.md', 'prompts/rules.md', 'character/rules.md', 'data/rules.md',
    'boundaries.md', 'safety.md', 'constraints.md',
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function resolveSourcePath(value: unknown): string {
  const source = readString(value).trim();
  if (!source) throw new Error('sourcePath 不能为空');
  return path.resolve(source);
}

function readTextIfExists(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return undefined;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function readStructuredFile(filePath: string): unknown {
  const text = readTextIfExists(filePath);
  if (text == null) return undefined;
  try {
    if (filePath.endsWith('.json')) return JSON.parse(text);
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return parseSimpleYaml(text);
  } catch {
    return undefined;
  }
  return undefined;
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!withoutComment.trim()) continue;
    const match = withoutComment.match(/^(\s*)([^:#]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const rawValue = match[3]?.trim() ?? '';
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (!rawValue) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseSimpleYamlScalar(rawValue);
    }
  }
  return root;
}

function parseSimpleYamlScalar(value: string): unknown {
  const unquoted = value.replace(/^['"]|['"]$/g, '');
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted === 'null') return null;
  const numberValue = Number(unquoted);
  return Number.isFinite(numberValue) && /^-?\d+(?:\.\d+)?$/.test(unquoted) ? numberValue : unquoted;
}

function walkFiles(root: string, maxFiles = 1000): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function findPromptFile(sourcePath: string, name: FragmentName, allFiles: string[]): string | undefined {
  for (const relative of PROMPT_CANDIDATES[name]) {
    const filePath = path.join(sourcePath, relative);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  }
  const aliases = name === 'persona'
    ? ['persona', 'character', 'profile']
    : name === 'style'
      ? ['style', 'tone', 'expression']
      : ['rules', 'boundaries', 'safety', 'constraints'];
  return allFiles.find((file) => {
    const base = path.basename(file).toLowerCase();
    return base.endsWith('.md') && aliases.some((alias) => base.includes(alias));
  });
}

function collectStructuredFiles(sourcePath: string, allFiles: string[]): unknown[] {
  const preferredNames = new Set([
    'config.json', 'config.yaml', 'config.yml', 'settings.json', 'settings.yaml', 'settings.yml',
    'virtual-lover.json', 'virtual-lover.yaml', 'virtual-lover.yml', 'virtual_lover.json', 'virtual_lover.yaml', 'delivery.json', 'delivery.yaml',
  ]);
  return allFiles
    .filter((file) => preferredNames.has(path.basename(file).toLowerCase()) || file.startsWith(path.join(sourcePath, 'config')))
    .map(readStructuredFile)
    .filter((value) => value !== undefined);
}

function findFirstStringByKey(value: unknown, keyPattern: RegExp): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKey(item, keyPattern);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (keyPattern.test(key) && (typeof item === 'string' || typeof item === 'number')) {
      const normalized = String(item).trim();
      if (normalized) return normalized;
    }
  }
  for (const item of Object.values(value)) {
    const found = findFirstStringByKey(item, keyPattern);
    if (found) return found;
  }
  return undefined;
}

function getNestedRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = source;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return isRecord(current) ? current : undefined;
}

function findLegacyTargetId(configs: unknown[]): string | undefined {
  for (const config of configs) {
    const direct = findFirstStringByKey(config, /^(telegramChatId|chatId|chat_id|targetId|target_id|channelId|channel_id)$/i);
    if (direct) return direct;
    if (isRecord(config)) {
      const target = getNestedRecord(config, ['proactive', 'target'])
        ?? getNestedRecord(config, ['delivery', 'target'])
        ?? getNestedRecord(config, ['telegram', 'target']);
      const id = target ? readString(target.id).trim() : '';
      if (id) return id;
    }
  }
  return undefined;
}

function findLegacyPolicy(configs: unknown[], policyId: string): Record<string, unknown> | undefined {
  for (const config of configs) {
    if (!isRecord(config)) continue;
    const policy = getNestedRecord(config, ['delivery', 'policies', policyId])
      ?? getNestedRecord(config, ['policies', policyId])
      ?? getNestedRecord(config, ['proactive', 'policy']);
    if (policy) return policy;
  }
  return undefined;
}

function parseMemoryCandidate(value: unknown): MemoryCandidate | undefined {
  if (typeof value === 'string') {
    const content = value.trim();
    return content ? { content, type: 'reference' } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const content = readString(value.content)
    || readString(value.text)
    || readString(value.memory)
    || readString(value.summary)
    || readString(value.value);
  const normalized = content.trim();
  if (!normalized) return undefined;
  const rawType = readString(value.type, 'reference').trim();
  const type = ['user', 'feedback', 'project', 'reference'].includes(rawType) ? rawType : 'reference';
  return {
    content: normalized,
    name: readString(value.name || value.title || value.key).trim() || undefined,
    description: readString(value.description || value.desc).trim() || undefined,
    type,
  };
}

function collectMemoryCandidates(sourcePath: string, allFiles: string[], maxItems: number): MemoryCandidate[] {
  const memoryFiles = allFiles.filter((file) => {
    const base = path.basename(file).toLowerCase();
    return /memor|remember|long.?term|relationship|lover/.test(base) && /\.(json|jsonl|ndjson|txt|md)$/.test(base);
  });
  const results: MemoryCandidate[] = [];
  for (const file of memoryFiles) {
    if (results.length >= maxItems) break;
    const text = readTextIfExists(file);
    if (!text) continue;
    if (file.endsWith('.jsonl') || file.endsWith('.ndjson')) {
      for (const line of text.split(/\r?\n/)) {
        if (results.length >= maxItems) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const candidate = parseMemoryCandidate(JSON.parse(trimmed));
          if (candidate) results.push(candidate);
        } catch {
          const candidate = parseMemoryCandidate(trimmed);
          if (candidate) results.push(candidate);
        }
      }
      continue;
    }
    if (file.endsWith('.json')) {
      const parsed = readStructuredFile(file);
      const values = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed)
          ? (Array.isArray(parsed.memories) ? parsed.memories
            : Array.isArray(parsed.items) ? parsed.items
              : Array.isArray(parsed.entries) ? parsed.entries
                : Object.values(parsed))
          : [];
      for (const item of values) {
        if (results.length >= maxItems) break;
        const candidate = parseMemoryCandidate(item);
        if (candidate) results.push(candidate);
      }
      continue;
    }
    const candidate = parseMemoryCandidate(text);
    if (candidate) results.push(candidate);
  }
  return results;
}

function mergeConfigUpdate(existingRaw: unknown, update: Record<string, unknown>): Record<string, unknown> {
  return deepMerge(isRecord(existingRaw) ? existingRaw : {}, update);
}

function deepMerge(base: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const existing = result[key];
    if (isRecord(existing) && isRecord(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function buildStrategyUpdateFromLegacy(configs: unknown[]): Record<string, unknown> {
  const strategies: Record<string, unknown> = {};
  const aliases: Array<[string, RegExp]> = [
    ['goodMorning', /^(goodMorning|morning|slotMorning)$/i],
    ['goodnight', /^(goodnight|night|slotNight)$/i],
    ['dailyCheckIn', /^(dailyCheckIn|checkIn|daily)$/i],
    ['random', /^(random|randomGreeting)$/i],
    ['lateNight', /^(lateNight|late_night)$/i],
  ];
  for (const config of configs) {
    if (!isRecord(config)) continue;
    const source = getNestedRecord(config, ['proactive', 'strategies'])
      ?? getNestedRecord(config, ['strategies'])
      ?? getNestedRecord(config, ['scheduler']);
    if (!source) continue;
    for (const [targetKey, pattern] of aliases) {
      const sourceKey = Object.keys(source).find((key) => pattern.test(key));
      const raw = sourceKey ? source[sourceKey] : undefined;
      if (isRecord(raw)) {
        const item: Record<string, unknown> = {};
        const enabled = readBoolean(raw.enabled);
        if (enabled !== undefined) item.enabled = enabled;
        const schedule = readString(raw.schedule || raw.cron || raw.expression).trim();
        if (schedule) item.schedule = schedule;
        const reason = readString(raw.reason || raw.prompt || raw.instruction).trim();
        if (reason) item.reason = reason;
        if (Object.keys(item).length > 0) strategies[targetKey] = item;
      } else if (typeof raw === 'boolean') {
        strategies[targetKey] = { enabled: raw };
      }
    }
  }
  return Object.keys(strategies).length > 0 ? strategies : {};
}

export function createVirtualLoverLegacyImportTool(ctx: PluginContext, api: IrisAPI): ToolDefinition {
  return {
    declaration: {
      name: VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME,
      description: 'Import legacy virtual-lover-in-real-life data into Iris virtual-lover. Supports dryRun and best-effort prompt/memory/delivery/strategy migration.',
      parameters: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: 'Path to the legacy virtual-lover data/config directory.' },
          dryRun: { type: 'boolean', description: 'Preview only. Defaults to true.' },
          agentId: { type: 'string', description: 'Target virtual-lover agent id. Defaults to current config agent id.' },
          bindingId: { type: 'string', description: 'Target delivery binding id. Defaults to current binding or lover-main.' },
          memorySpace: { type: 'string', description: 'Target Iris memory space. Defaults to virtual-lover config memory space.' },
          overwritePrompt: { type: 'boolean', description: 'Overwrite existing prompt fragments. Default false.' },
          maxMemoryItems: { type: 'number', description: 'Max legacy memory items to import. Default 500.' },
          targetId: { type: 'string', description: 'Optional explicit delivery target id, e.g. Telegram chat_id.' },
          policyId: { type: 'string', description: 'Optional delivery policy id to bind to the imported target.' },
        },
        required: ['sourcePath'],
      },
    },
    parallel: false,
    handler: async (args) => {
      const sourcePath = resolveSourcePath(args.sourcePath);
      const dryRun = args.dryRun !== false;
      const report: ImportReport = {
        sourcePath,
        dryRun,
        prompt: { found: [], imported: [], skipped: [] },
        memory: { found: 0, imported: 0, skipped: 0 },
        delivery: { imported: false },
        config: { imported: false, strategyKeys: [] },
        warnings: [],
      };

      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
        return { ok: false, error: `sourcePath 不存在或不是目录: ${sourcePath}`, report };
      }

      const currentConfig = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
      const agentId = readString(args.agentId, currentConfig.agent.defaultAgentId).trim() || currentConfig.agent.defaultAgentId;
      const bindingId = readString(args.bindingId, currentConfig.proactive.binding ?? 'lover-main').trim() || 'lover-main';
      const memorySpace = readString(args.memorySpace, currentConfig.memory.space).trim() || currentConfig.memory.space;
      const overwritePrompt = args.overwritePrompt === true;
      const maxMemoryItems = Math.max(0, Math.trunc(readNumber(args.maxMemoryItems) ?? 500));
      const allFiles = walkFiles(sourcePath);
      const configs = collectStructuredFiles(sourcePath, allFiles);

      // Prompt fragments
      for (const fragment of ['persona', 'style', 'rules'] as FragmentName[]) {
        const file = findPromptFile(sourcePath, fragment, allFiles);
        if (!file) {
          report.prompt.skipped.push(`${fragment}: 未找到旧文件`);
          continue;
        }
        report.prompt.found.push(file);
        const content = readTextIfExists(file)?.trim();
        if (!content) {
          report.prompt.skipped.push(`${fragment}: 文件为空`);
          continue;
        }
        const existing = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId).fragments[fragment].trim();
        if (!overwritePrompt && existing) {
          report.prompt.skipped.push(`${fragment}: 目标已存在内容，未覆盖`);
          continue;
        }
        if (!dryRun) writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, fragment, content);
        report.prompt.imported.push(fragment);
      }

      // Memory items
      const memoryCandidates = collectMemoryCandidates(sourcePath, allFiles, maxMemoryItems);
      report.memory.found = memoryCandidates.length;
      if (memoryCandidates.length > 0) {
        const service = api.services.get<MemorySpacesServiceLike>(MEMORY_SPACES_SERVICE_ID);
        if (!service) {
          report.memory.reason = 'memory.spaces service 不可用，无法导入记忆';
          report.memory.skipped = memoryCandidates.length;
        } else if (!dryRun) {
          const space = service.getOrCreateSpace(memorySpace);
          for (const item of memoryCandidates) {
            await space.add(item);
            report.memory.imported += 1;
          }
        }
      }

      // Delivery/config migration
      const targetId = readString(args.targetId).trim() || findLegacyTargetId(configs);
      const policyId = readString(args.policyId, currentConfig.proactive.policy ?? '').trim() || undefined;
      report.delivery.bindingId = bindingId;
      report.delivery.targetId = targetId;
      report.delivery.policyId = policyId;

      const strategyUpdate = buildStrategyUpdateFromLegacy(configs);
      report.config.strategyKeys = Object.keys(strategyUpdate);

      if (!dryRun && api.configManager) {
        const editable = api.configManager.readEditableConfig?.() as Record<string, unknown> | undefined;
        const virtualLoverUpdate = mergeConfigUpdate(editable?.virtual_lover ?? ctx.readConfigSection('virtual_lover'), {
          agent: { defaultAgentId: agentId },
          memory: { space: memorySpace },
          proactive: {
            binding: bindingId,
            policy: policyId,
            ...(Object.keys(strategyUpdate).length > 0 ? { strategies: strategyUpdate } : {}),
          },
        });
        const payload: Record<string, unknown> = { virtual_lover: virtualLoverUpdate };
        if (targetId) {
          payload.delivery = {
            bindings: {
              [bindingId]: {
                platform: 'telegram',
                target: { kind: 'chat', id: targetId },
                enabled: true,
                policyId,
              },
            },
          };
          const legacyPolicy = policyId ? findLegacyPolicy(configs, policyId) : undefined;
          if (policyId && legacyPolicy) {
            (payload.delivery as Record<string, unknown>).policies = { [policyId]: legacyPolicy };
          }
          report.delivery.imported = true;
        }
        const result = api.configManager.updateEditableConfig(payload as any);
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        report.config.imported = true;
      } else if (!api.configManager && !dryRun) {
        report.warnings.push('configManager 不可用，无法写入 virtual_lover.yaml / delivery.yaml');
      }

      if (dryRun) {
        report.warnings.push('dryRun=true：未写入任何文件、记忆或配置。确认报告后用 dryRun=false 执行导入。');
      }

      return { ok: true, report };
    },
  };
}
