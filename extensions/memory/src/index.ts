/**
 * Memory 扩展插件入口
 *
 * 实现 IrisPlugin 接口，在 activate 阶段初始化记忆存储并注册工具，
 * 通过钩子实现 autoRecall（自动召回）机制。
 *
 * 配置文件由插件自行管理（configs/memory.yaml），
 * 通过 ensureConfigFile SDK 在首次安装时自动释放默认模板。
 */

import * as path from 'path';
import { definePlugin, createPluginLogger } from '@irises/extension-sdk';
import type { PluginContext, IrisAPI, LLMRequest, Part } from '@irises/extension-sdk';
import { SqliteMemory } from './sqlite/index.js';
import { createMemoryTools, MEMORY_TOOL_NAMES } from './tools.js';
import { MemoryProvider } from './base.js';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';

const logger = createPluginLogger('memory');

interface MemoryPluginConfig {
  enabled?: boolean;
  dbPath?: string;
}

/** 当前活跃的 Provider 实例 */
let activeProvider: MemoryProvider | undefined;

/** 缓存的 API 引用 */
let cachedApi: IrisAPI | undefined;

/** 上一次用户输入文本（用于 autoRecall） */
let lastUserText: string | undefined;

/** 本轮是否已注入记忆上下文（确保只在首次 LLM 调用时注入） */
let memoryInjectedThisRound = false;

/** 是否启用 autoRecall（当存在子代理 recall 类型时禁用，由 recall 子代理接管） */
let autoRecallEnabled = true;

export default definePlugin({
  name: 'memory',
  version: '0.1.0',
  description: '长期记忆系统 — SQLite + FTS5 全文检索',

  activate(ctx: PluginContext) {
    // 1. 释放默认配置模板（仅首次，不覆盖已有文件）
    const created = ctx.ensureConfigFile('memory.yaml', DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger.info('已在配置目录中安装 memory.yaml 默认模板');
    }

    // 2. 读取配置，未启用则直接返回
    const rawConfig = ctx.readConfigSection('memory');
    const config = resolveConfig(rawConfig, ctx.getPluginConfig<MemoryPluginConfig>());
    if (!config.enabled) {
      logger.info('记忆系统未启用');
      return;
    }

    // 3. onReady：创建 Provider、注册工具、检测子代理、注入引导
    ctx.onReady(async (api) => {
      cachedApi = api;

      // 解析数据库路径
      const dbPath = config.dbPath
        ? path.resolve(ctx.getConfigDir(), config.dbPath)
        : path.join(api.dataDir ?? ctx.getConfigDir(), 'memory.db');

      // 创建 Provider
      activeProvider = new SqliteMemory(dbPath, logger);

      // 注册 3 个记忆工具
      const tools = createMemoryTools(activeProvider);
      api.tools.registerAll(tools);
      logger.info(`记忆工具已注册（${tools.length} 个）`);

      // 将 provider 实例挂载到 api.memory 以供其他插件访问
      (api as any).memory = activeProvider;

      // 检测子代理：若存在 sub_agent 工具，则禁用 autoRecall（由 recall 子代理接管）
      const hasSubAgents = !!api.tools.get('sub_agent');
      autoRecallEnabled = !hasSubAgents;

      if (hasSubAgents) {
        // 记忆特有的子代理引导：告知 LLM 如何使用 recall 和直接调用 memory 工具
        ctx.addSystemPromptPart({
          text: '\n- 需要检索长期记忆时，使用 recall 子代理\n- memory_add 和 memory_delete 请直接使用，不要委派',
        });
        logger.info('autoRecall 已禁用（存在子代理，由 recall 类型处理检索）');
      } else {
        logger.info('autoRecall 已启用（无子代理，插件自动注入记忆上下文）');
      }
    });

    // 4. 钩子：捕获用户输入（不修改，仅记录）
    ctx.addHook({
      name: 'memory:capture-user-text',
      priority: 200,
      onBeforeChat({ text }) {
        lastUserText = text;
        memoryInjectedThisRound = false;
        return undefined; // 不修改用户消息
      },
    });

    // 5. 钩子：autoRecall——在首次 LLM 调用前注入记忆上下文
    ctx.addHook({
      name: 'memory:auto-recall',
      priority: 100,
      async onBeforeLLMCall({ request }) {
        // 仅在 autoRecall 启用、有用户输入、本轮未注入时执行
        if (!autoRecallEnabled || !activeProvider || !lastUserText || memoryInjectedThisRound) {
          return undefined;
        }
        memoryInjectedThisRound = true;

        try {
          const context = await activeProvider.buildContext(lastUserText);
          if (!context) return undefined;

          // 将记忆上下文追加到 systemInstruction
          const sysInst = request.systemInstruction;
          const existingParts: Part[] = sysInst?.parts ? [...sysInst.parts] : [];
          existingParts.push({ text: context });

          return {
            request: {
              ...request,
              systemInstruction: { parts: existingParts },
            },
          };
        } catch (err) {
          logger.warn('查询记忆失败:', err);
          return undefined;
        }
      },
    });

    // 6. 钩子：配置热重载
    ctx.addHook({
      name: 'memory:config-reload',
      async onConfigReload() {
        if (!cachedApi) return;

        const newRaw = ctx.readConfigSection('memory');
        const newConfig = resolveConfig(newRaw, ctx.getPluginConfig<MemoryPluginConfig>());

        if (!newConfig.enabled) {
          // 禁用时注销工具
          for (const name of MEMORY_TOOL_NAMES) {
            (cachedApi.tools as any).unregister?.(name);
          }
          activeProvider = undefined;
          (cachedApi as any).memory = undefined;
          logger.info('记忆系统已禁用（配置重载）');
          return;
        }

        // 启用时重新初始化
        const dbPath = newConfig.dbPath
          ? path.resolve(ctx.getConfigDir(), newConfig.dbPath)
          : path.join(cachedApi.dataDir ?? ctx.getConfigDir(), 'memory.db');

        activeProvider = new SqliteMemory(dbPath, logger);
        (cachedApi as any).memory = activeProvider;

        // 重新注册工具（先注销旧的）
        for (const name of MEMORY_TOOL_NAMES) {
          (cachedApi.tools as any).unregister?.(name);
        }
        cachedApi.tools.registerAll(createMemoryTools(activeProvider));
        logger.info('记忆系统已重载');
      },
    });
  },

  async deactivate() {
    activeProvider = undefined;
    cachedApi = undefined;
    lastUserText = undefined;
  },
});

// ============ 内部辅助 ============

/** 解析配置（优先级：独立 yaml 文件 > pluginConfig > 默认值） */
function resolveConfig(
  rawSection: Record<string, unknown> | undefined,
  pluginConfig: MemoryPluginConfig | undefined,
): MemoryPluginConfig {
  const source = rawSection ?? pluginConfig ?? {};
  return {
    enabled: (source as any).enabled ?? false,
    dbPath: (source as any).dbPath,
  };
}
