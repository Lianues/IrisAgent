/**
 * 配置模块统一入口
 *
 * 从 ~/.iris/configs/ 目录加载分文件配置。
 *
 * 配置文件：
 *   llm.yaml        - LLM 配置
 *   ocr.yaml      - OCR 配置（可选）
 *   platform.yaml - 平台配置
 *   storage.yaml  - 存储配置
 *   tools.yaml    - 工具执行配置
 *   system.yaml   - 系统配置
 *   memory.yaml   - 记忆配置（可选）
 *   mcp.yaml      - MCP 配置（可选）
 *   modes.yaml    - 模式配置（可选）
 *   sub_agents.yaml - 子代理配置（可选）
 *   plugins.yaml  - 插件配置（可选）
 */

import * as fs from 'fs';
import * as path from 'path';
import { configDir as globalConfigDir, dataDir as globalDataDir, projectRoot } from '../paths';
import { EMBEDDED_CONFIG_DEFAULTS } from './embedded-defaults';
import type { AgentPaths } from '../paths';
import { AppConfig, GlobalConfig } from './types';
import { parseLLMConfig } from './llm';
import { fieldOverride, entryMerge } from './merge';
import type { ConfigSectionKey } from './raw';
import { parsePlatformConfig } from './platform';
import { parseStorageConfig } from './storage';
import { parseToolsConfig } from './tools';
import { parseSystemConfig } from './system';
import { parseModeConfig } from './mode';
import { parseSubAgentsConfig } from './sub_agents';
import { loadRawConfigDir } from './raw';
import { parsePluginsConfig } from './plugins';
import { parseSummaryConfig } from './summary';
import { parseDeliveryConfig } from './delivery';
import { discoverLocalExtensions } from '../extension/registry';
import type { ExtensionPackage } from 'irises-extension-sdk';
import { createLogger } from '../logger';

const pluginsLogger = createLogger('PluginsConfig');

export type {
  AppConfig,
  GlobalConfig,
  LLMConfig,
  LLMModelDef,
  LLMRegistryConfig,
  PlatformConfig,
  StorageConfig,
  ToolPolicyConfig,
  ToolsConfig,
  SystemConfig,
  SummaryConfig,
  SubAgentsConfig,
  SubAgentTypeDef,
} from './types';

/**
 * 返回配置目录的绝对路径。
 *
 * @param customConfigDir  指定配置目录（Agent 模式使用）
 * @param isAgentDir       是否为 Agent 的 configDir（true 时不阻断启动）
 *
 * 查找顺序：
 *   1. customConfigDir（若提供）或 ~/.iris/configs/
 *   2. 自动从项目的 data/configs.example/ 初始化到目标目录
 *
 * 多 Agent 配置分层重构：Agent 的 configDir 不存在时仅创建空目录，
 * 不再 process.exit(0) 要求填写 API Key——因为 LLM 等全局配置来自全局层。
 * 只有全局 configDir 首次初始化时才阻断启动。
 */
export function findConfigFile(customConfigDir?: string, isAgentDir?: boolean): string {
  const targetDir = customConfigDir || globalConfigDir;
  if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
    return targetDir;
  }

  // 多 Agent 分层重构：Agent 的 configDir 不存在时只创建空目录，不阻断启动。
  // Agent 的配置通过 loadAgentConfig 从全局配置继承，空 configs/ = 完全继承全局。
  if (isAgentDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }

  // 2. 首次运行：从项目模板自动初始化
  const exampleDir = path.join(projectRoot, 'data/configs.example');
  if (fs.existsSync(exampleDir) && fs.statSync(exampleDir).isDirectory()) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(exampleDir, targetDir, { recursive: true });
    console.log(`[Iris] 已初始化配置目录: ${targetDir}`);

    // 初始化全局配置时，同时拷贝 agents.yaml 和示例 agent 配置
    if (!customConfigDir) {
      initAgentsData(projectRoot, globalDataDir);
    }

    console.log('[Iris] 请编辑配置文件（至少填写 LLM API Key）后重新启动。');
    process.exit(0);
    return targetDir;
  }

  // 3. 兜底：使用内嵌默认配置初始化（编译后二进制且 data/ 不可用时）
  console.log('[Iris] 未找到配置模板目录，使用内嵌默认配置初始化...');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [filename, content] of Object.entries(EMBEDDED_CONFIG_DEFAULTS)) {
    fs.writeFileSync(path.join(targetDir, filename), content, 'utf-8');
  }

  // 初始化全局配置时，同时尝试拷贝 agents 数据（若源文件可用）
  if (!customConfigDir) {
    initAgentsData(projectRoot, globalDataDir);
  }

  console.log(`[Iris] 已初始化配置目录: ${targetDir}`);
  console.log('[Iris] 请编辑配置文件（至少填写 LLM API Key）后重新启动。');
  process.exit(0);
  return targetDir;
}

/**
 * 加载配置。
 * @param customConfigDir  指定配置目录（多 Agent 模式使用）
 * @param agentPaths       Agent 专属路径集，用于填充存储/记忆的默认路径
 */
export function loadConfig(customConfigDir?: string, agentPaths?: AgentPaths): AppConfig {
  const configsDir = findConfigFile(customConfigDir);
  const data = loadRawConfigDir(configsDir);
  // Skill 文件系统扫描需要数据目录：Agent 模式用 agentPaths.dataDir，否则用全局 dataDir
  const effectiveDataDir = agentPaths?.dataDir || globalDataDir;

  return {
    llm: parseLLMConfig(data.llm),
    ocr: data.ocr,
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage, agentPaths),
    tools: parseToolsConfig(data.tools),
    system: parseSystemConfig(data.system, effectiveDataDir),
    // mcp: handled by mcp extension via readConfigSection,
    modes: parseModeConfig(data.modes),
    subAgents: parseSubAgentsConfig(data.sub_agents),
    plugins: parsePluginsConfig(data.plugins),
    summary: parseSummaryConfig(data.summary),
    delivery: parseDeliveryConfig(data.delivery),
  };
}


/**
 * 将配置目录重置为默认值。
 * 优先从 data/configs.example/ 复制，不可用时使用内嵌默认配置。
 */
export function resetConfigToDefaults(): { success: boolean; message: string } {
  // 确保目标目录存在
  if (!fs.existsSync(globalConfigDir)) {
    fs.mkdirSync(globalConfigDir, { recursive: true });
  }

  const exampleDir = path.join(projectRoot, 'data/configs.example');
  if (fs.existsSync(exampleDir) && fs.statSync(exampleDir).isDirectory()) {
    fs.cpSync(exampleDir, globalConfigDir, { recursive: true });
    return { success: true, message: `配置已重置为默认值: ${globalConfigDir}` };
  }

  // 兜底：使用内嵌默认配置
  for (const [filename, content] of Object.entries(EMBEDDED_CONFIG_DEFAULTS)) {
    fs.writeFileSync(path.join(globalConfigDir, filename), content, 'utf-8');
  }
  return { success: true, message: `配置已重置为默认值: ${globalConfigDir}` };
}


/**
 * 首次初始化时拷贝 agents.yaml 和示例 agent 配置到数据目录。
 * 仅在全局 configs 首次初始化时调用（不影响已有数据）。
 */
function initAgentsData(projRoot: string, dataDirPath: string): void {
  // 拷贝 agents.yaml.example → ~/.iris/agents.yaml
  const agentsYamlExample = path.join(projRoot, 'data/agents.yaml.example');
  const agentsYamlTarget = path.join(dataDirPath, 'agents.yaml');
  if (fs.existsSync(agentsYamlExample) && !fs.existsSync(agentsYamlTarget)) {
    fs.copyFileSync(agentsYamlExample, agentsYamlTarget);
    console.log(`[Iris] 已初始化多 Agent 配置: ${agentsYamlTarget}`);
  }

  // 拷贝 agents.example/ → ~/.iris/agents/
  const agentsExampleDir = path.join(projRoot, 'data/agents.example');
  const agentsTargetDir = path.join(dataDirPath, 'agents');
  if (fs.existsSync(agentsExampleDir) && !fs.existsSync(agentsTargetDir)) {
    fs.cpSync(agentsExampleDir, agentsTargetDir, { recursive: true });
    console.log(`[Iris] 已初始化示例 Agent 配置: ${agentsTargetDir}`);
  }
}

// ============ 分层配置加载（多 Agent 配置分层重构） ============

/** loadGlobalConfig 的返回值类型 */
export interface GlobalConfigResult {
  config: GlobalConfig;
  /** 全部原始数据，用于第二类配置与 Agent 层合并 */
  raw: Partial<Record<ConfigSectionKey, any>>;
}

/**
 * 加载全局配置（从 ~/.iris/configs/ 读取所有文件）。
 *
 * 多 Agent 配置分层重构：全局配置只加载一次，由 IrisHost 持有。
 * 返回 GlobalConfig（第一类：全局独占）和 raw 原始数据（用于第二类合并）。
 */
export function loadGlobalConfig(): GlobalConfigResult {
  const configsDir = findConfigFile();
  const raw = loadRawConfigDir(configsDir);

  const config: GlobalConfig = {
    llm: parseLLMConfig(raw.llm),
    ocr: raw.ocr,
    storage: parseStorageConfig(raw.storage),
  };

  return { config, raw };
}

/**
 * 加载 Agent 的最终配置：分层合并全局配置与 Agent 覆盖。
 *
 * 多 Agent 配置分层重构：
 *   - LLM：按 Settings UI 的写入语义分层合并（顶层字段覆盖 + models 条目级合并）
 *   - OCR / storage：继续使用全局基线配置（storage 仅注入 agent 专属路径）
 *   - 第二类（system/tools/summary/mcp/modes/sub_agents）：读取 Agent 同名文件，与全局 raw 合并
 *   - Agent 目录不存在或为空时：完全继承全局配置
 *
 * @param globalResult  loadGlobalConfig 的返回值
 * @param agentPaths    Agent 专属路径集（不提供时使用全局配置目录）
 */
export function loadAgentConfig(
  globalResult: GlobalConfigResult,
  agentPaths?: AgentPaths,
): AppConfig {
  const { config: globalCfg, raw: globalRaw } = globalResult;

  // 读取 Agent 层的 raw 配置（可能为空对象，表示完全继承）
  let agentRaw: Partial<Record<ConfigSectionKey, any>> = {};
  if (agentPaths?.configDir) {
    // isAgentDir=true：不存在时仅创建空目录，不阻断
    findConfigFile(agentPaths.configDir, true);
    agentRaw = loadRawConfigDir(agentPaths.configDir);
  }

  const effectiveDataDir = agentPaths?.dataDir || globalDataDir;

  // --- LLM：分层合并 ---
  // Settings UI 通过 LayeredConfigManager 把 llm.yaml 写入 agent 覆盖层；
  // 这里必须使用相同的合并语义，否则启动阶段只能看到全局层模型，
  // 直到 Settings 保存触发热重载后才会恢复正确的 /model 列表。
  const mergedLLMRaw = (globalRaw.llm || agentRaw.llm) ? {
    ...fieldOverride(globalRaw.llm ?? {}, agentRaw.llm ?? {}),
    models: entryMerge(globalRaw.llm?.models, agentRaw.llm?.models),
  } : undefined;
  const llm = parseLLMConfig(mergedLLMRaw);

  // --- OCR / storage：保持全局基线 ---
  const ocr = globalCfg.ocr;
  const storage = parseStorageConfig(globalRaw.storage, agentPaths);

  // --- 第二类字段级覆盖：system / tools / summary ---
  const mergedSystemRaw = fieldOverride(globalRaw.system ?? {}, agentRaw.system);
  const mergedToolsRaw = fieldOverride(globalRaw.tools ?? {}, agentRaw.tools);
  const mergedSummaryRaw = fieldOverride(globalRaw.summary ?? {}, agentRaw.summary);

  // 提前解析 system，便于 plugins 合并阶段按 system.extensions 做发现校验。
  const system = parseSystemConfig(mergedSystemRaw, effectiveDataDir);

  // --- 第二类条目级合并：modes / sub_agents ---
  // modes: 按模式名合并（原始数据是对象形式，key = 模式名）
  const mergedModesRaw = (globalRaw.modes || agentRaw.modes)
    ? entryMerge(globalRaw.modes, agentRaw.modes)
    : undefined;

  // sub_agents: 按 types key 合并，全局 enabled/stream 开关作为基底
  const mergedSubAgentsRaw = (globalRaw.sub_agents || agentRaw.sub_agents) ? {
    ...fieldOverride(globalRaw.sub_agents ?? {}, agentRaw.sub_agents ?? {}),
    types: entryMerge(globalRaw.sub_agents?.types, agentRaw.sub_agents?.types),
  } : undefined;

  // platform: 从全局 raw 读取（不进入 Agent 分层体系）
  const platform = parsePlatformConfig(globalRaw.platform);

  const mergedDeliveryRaw = (globalRaw.delivery || agentRaw.delivery) ? {
    ...fieldOverride(globalRaw.delivery ?? {}, agentRaw.delivery ?? {}),
    bindings: entryMerge(globalRaw.delivery?.bindings, agentRaw.delivery?.bindings),
    policies: entryMerge(globalRaw.delivery?.policies, agentRaw.delivery?.policies),
  } : undefined;

  // plugins.yaml 分层语义：
  //   - 全局 plugins.yaml 只能控制 installed + embedded（全局可见的扩展）
  //   - agent  plugins.yaml 可声明 agent-installed 扩展，并覆盖全局可见扩展的 enabled/priority/config
  //   - 任意层若列出"既不在对应源也不在更高优先级源"中的条目，会被 warn 后忽略；
  //     例外：type === 'npm' 的条目按"全局基础设施"原则保留，但仅允许出现在全局层。
  const globalPlugins = parsePluginsConfig(globalRaw.plugins) ?? [];
  const agentPlugins  = parsePluginsConfig(agentRaw.plugins)  ?? [];
  const effectivePlugins = classifyAndMergePlugins(globalPlugins, agentPlugins, {
    agentExtensionsDir: agentPaths?.extensionsDir,
    workspaceEnabled: system.extensions?.loadWorkspaceExtensions === true,
    workspaceAllowlist: system.extensions?.workspaceAllowlist ?? [],
    agentLabel: agentPaths?.configDir ? path.basename(path.dirname(agentPaths.configDir)) : 'global',
  });

  return {
    llm,
    ocr,
    platform,
    storage,
    tools: parseToolsConfig(mergedToolsRaw),
    system,
    // mcp: handled by mcp extension via readConfigSection,
    modes: parseModeConfig(mergedModesRaw),
    subAgents: parseSubAgentsConfig(mergedSubAgentsRaw),
    plugins: effectivePlugins.length > 0 ? effectivePlugins : undefined,
    summary: parseSummaryConfig(mergedSummaryRaw),
    delivery: parseDeliveryConfig(mergedDeliveryRaw),
  };
}

/**
 * 按"全局只管全局，agent 只管 agent + 覆盖"的语义合并 plugins 条目。
 *
 * 算法：
 *   1. 用 ExtensionDiscoveryOptions 做一次发现，得到当前 agent 上下文下的扩展包列表。
 *   2. 按 source 把扩展名分桶：
 *        globalScope = installed + embedded   （全局层合法 + agent 层可覆盖）
 *        agentScope  = agent-installed         （仅 agent 层合法）
 *   3. 全局层条目：name ∈ globalScope 直接生效；type==='npm' 直接生效；其它 warn 丢弃。
 *   4. agent 层条目：
 *        - name ∈ agentScope            → 视为 agent 自己的声明
 *        - name ∈ globalScope           → 视为对全局的覆盖（浅合并 enabled/priority/config）
 *        - 其它                         → warn 丢弃
 */
function classifyAndMergePlugins(
  globalPlugins: import('irises-extension-sdk').PluginEntry[],
  agentPlugins: import('irises-extension-sdk').PluginEntry[],
  ctx: {
    agentExtensionsDir?: string;
    workspaceEnabled: boolean;
    workspaceAllowlist: string[];
    agentLabel: string;
  },
): import('irises-extension-sdk').PluginEntry[] {
  let packages: ExtensionPackage[] = [];
  try {
    packages = discoverLocalExtensions({
      agentExtensionsDir: ctx.agentExtensionsDir,
      workspace: { enabled: ctx.workspaceEnabled, allowlist: ctx.workspaceAllowlist },
    });
  } catch (err) {
    pluginsLogger.warn(`扩展发现失败，plugins.yaml 归属校验跳过：${err instanceof Error ? err.message : String(err)}`);
  }

  const globalScope = new Set<string>();
  const agentScope = new Set<string>();
  for (const pkg of packages) {
    if (pkg.source === 'installed' || pkg.source === 'embedded') globalScope.add(pkg.manifest.name);
    else if (pkg.source === 'agent-installed') agentScope.add(pkg.manifest.name);
    // workspace 类型同样属于"全局可见"（所有 agent 共用），归入 globalScope
    else if (pkg.source === 'workspace') globalScope.add(pkg.manifest.name);
  }

  const merged = new Map<string, import('irises-extension-sdk').PluginEntry>();

  for (const entry of globalPlugins) {
    if (entry.type === 'npm' || globalScope.has(entry.name)) {
      merged.set(entry.name, entry);
    } else {
      pluginsLogger.warn(
        `全局 plugins.yaml 列了未发现的扩展 "${entry.name}"，已忽略。` +
        `（提示：agent 专属扩展应配置在 ~/.iris/agents/<id>/configs/plugins.yaml）`,
      );
    }
  }

  for (const entry of agentPlugins) {
    if (entry.type === 'npm') {
      pluginsLogger.warn(
        `agent[${ctx.agentLabel}] plugins.yaml 出现 type=npm 的 "${entry.name}"，` +
        `npm 类扩展只能在全局 plugins.yaml 声明，已忽略。`,
      );
      continue;
    }

    const inAgentScope = agentScope.has(entry.name);
    const inGlobalScope = globalScope.has(entry.name);

    if (!inAgentScope && !inGlobalScope) {
      pluginsLogger.warn(
        `agent[${ctx.agentLabel}] plugins.yaml 列了未发现的扩展 "${entry.name}"，已忽略。`,
      );
      continue;
    }

    const previous = merged.get(entry.name);
    merged.set(entry.name, {
      ...(previous ?? {}),
      ...entry,
      // 此处 entry.type 已被上面 continue 排除 'npm'，按 entry > previous 的优先级合并即可。
      type: entry.type ?? previous?.type,
      priority: entry.priority ?? previous?.priority,
      config: entry.config ?? previous?.config,
    });
  }

  return Array.from(merged.values());
}

