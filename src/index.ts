/**
 * 入口文件
 *
 * 根据配置创建各模块实例，组装并启动应用。
 */

import { loadConfig, findConfigFile } from './config';

// 平台
import { PlatformAdapter } from './platforms/base';
import { ConsolePlatform } from './platforms/console';
import { DiscordPlatform } from './platforms/discord';
import { TelegramPlatform } from './platforms/telegram';
import { WebPlatform } from './platforms/web';

// LLM
import { createLLMRouter } from './llm/factory';

// 存储
import { JsonFileStorage } from './storage/json-file';
import { SqliteStorage } from './storage/sqlite';

// 记忆
import { createMemoryProvider, createMemoryTools, MemoryProvider } from './memory';

// MCP
import { createMCPManager, MCPManager } from './mcp';

// 工具
import { ToolRegistry } from './tools/registry';
import { getCurrentTime, calculator } from './tools/builtin/example';
import { readFile } from './tools/builtin/read-file';
import { searchReplace } from './tools/builtin/search-replace';
import { terminal } from './tools/builtin/terminal';
import { applyDiff } from './tools/builtin/apply-diff';
import { createAgentTool } from './tools/builtin/agent';

// 子 Agent
import { AgentTypeRegistry, createDefaultAgentTypes, buildAgentGuidance } from './core/agent-types';

// 提示词
import { PromptAssembler } from './prompt/assembler';
import { DEFAULT_SYSTEM_PROMPT } from './prompt/templates/default';

// 核心
import { Orchestrator } from './core/orchestrator';

async function main() {
  const config = loadConfig();

  // ---- 1. 创建 LLM 路由器（三层） ----
  const router = createLLMRouter(config.llm);

  // ---- 2. 创建存储 ----
  let storage;
  switch (config.storage.type) {
    case 'sqlite':
      storage = new SqliteStorage(config.storage.dbPath);
      break;
    case 'json-file':
    default:
      storage = new JsonFileStorage(config.storage.dir);
      break;
  }

  // ---- 2.5 创建记忆模块 ----
  let memory: MemoryProvider | undefined;
  if (config.memory?.enabled) {
    memory = createMemoryProvider({ dbPath: config.memory.dbPath });
  }

  // ---- 3. 注册工具 ----
  const tools = new ToolRegistry();
  tools.registerAll([getCurrentTime, calculator, readFile, searchReplace, terminal, applyDiff]);
  if (memory) {
    tools.registerAll(createMemoryTools(memory));
  }

  // ---- 3.1 连接 MCP 服务器（后台异步，不阻塞启动） ----
  let mcpManager: MCPManager | undefined;
  if (config.mcp) {
    mcpManager = createMCPManager(config.mcp);
    mcpManager.connectAll().then(() => {
      tools.registerAll(mcpManager!.getTools());
    });
  }

  // ---- 3.5 注册子 Agent 工具 ----
  const agentTypes = new AgentTypeRegistry();
  for (const t of createDefaultAgentTypes()) {
    // recall 类型仅在记忆模块启用时注册
    if (t.name === 'recall' && !memory) continue;
    agentTypes.register(t);
  }
  // orchestrator 在后面创建，但闭包在运行时才求值，此时已完成初始化
  let orchestrator: Orchestrator;
  tools.register(createAgentTool({
    getRouter: () => orchestrator.getRouter(),
    tools,
    agentTypes,
    maxDepth: config.system.maxAgentDepth,
  }));

  // ---- 3.6 构建 Agent 协调指导 ----
  const agentGuidance = buildAgentGuidance(agentTypes, !!memory);

  // ---- 4. 创建平台适配器 ----
  let platform: PlatformAdapter;
  switch (config.platform.type) {
    case 'discord':
      platform = new DiscordPlatform({ token: config.platform.discord.token });
      break;
    case 'telegram':
      platform = new TelegramPlatform({ token: config.platform.telegram.token });
      break;
    case 'web':
      platform = new WebPlatform({
        port: config.platform.web.port,
        host: config.platform.web.host,
        authToken: config.platform.web.authToken,
        managementToken: config.platform.web.managementToken,
        storage,
        tools,
        configPath: findConfigFile(),
        llmName: config.llm.primary.provider,
        modelName: config.llm.primary.model,
        streamEnabled: config.system.stream,
      });
      break;
    case 'console':
    default:
      platform = new ConsolePlatform();
      break;
  }

  // ---- 5. 配置提示词 ----
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt(config.system.systemPrompt || DEFAULT_SYSTEM_PROMPT);

  // ---- 6. 创建并启动协调器 ----
  // agents+memory 同时激活时关闭自动召回，由 recall agent 代替
  const autoRecall = !(memory && tools.get('agent'));

  orchestrator = new Orchestrator(platform, router, storage, tools, prompt, {
    maxToolRounds: config.system.maxToolRounds,
    stream: config.system.stream,
    autoRecall,
    agentGuidance,
  }, memory);

  // 注入 Orchestrator 和 MCP 管理器到 WebPlatform（支持配置热重载）
  if (platform instanceof WebPlatform) {
    platform.setOrchestrator(orchestrator);
    if (mcpManager) platform.setMCPManager(mcpManager);
  }

  await orchestrator.start();

  // ---- 退出清理（防重入） ----
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      // WebPlatform 热重载可能创建了新的 MCPManager，取最新引用
      const activeMcp = (platform instanceof WebPlatform) ? platform.getMCPManager() : mcpManager;
      if (activeMcp) await activeMcp.disconnectAll();
      await orchestrator.stop();
    } catch (err) {
      console.error('清理时出错:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
