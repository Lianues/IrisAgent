/**
 * Agent 工具 —— 派生子代理执行复杂子任务
 *
 * 主 LLM 通过此工具创建独立的子 Agent，
 * 每个子 Agent 拥有独立上下文、独立工具集、独立工具循环。
 *
 * 子代理直接复用 ToolLoop（与 Orchestrator/CLI 相同的核心引擎），
 * 支持真正的嵌套自我调用。
 */

import { ToolDefinition } from '../../types';
import { LLMRouter } from '../../llm/router';
import { ToolRegistry } from '../registry';
import { AgentTypeRegistry } from '../../core/agent-types';
import { ToolLoop, LLMCaller } from '../../core/tool-loop';
import { PromptAssembler } from '../../prompt/assembler';
import { ModeRegistry, applyToolFilter } from '../../modes';
import { createLogger } from '../../logger';

const logger = createLogger('AgentTool');

export interface AgentToolDeps {
  /** 动态获取 router（支持热重载后取到最新实例） */
  getRouter: () => LLMRouter;
  tools: ToolRegistry;
  agentTypes: AgentTypeRegistry;
  maxDepth: number;
  /** 模式注册表（可选） */
  modeRegistry?: ModeRegistry;
}

/**
 * 创建 agent 工具
 *
 * @param deps         依赖注入
 * @param currentDepth 当前嵌套深度（0 = 顶层）
 */
export function createAgentTool(deps: AgentToolDeps, currentDepth: number = 0): ToolDefinition {
  const typeDescriptions = deps.agentTypes.getAll()
    .map(t => `  - ${t.name}: ${t.description}`)
    .join('\n');

  const toolDescription = `启动子代理执行子任务。子代理拥有独立上下文和工具循环，完成后返回结果。\n\n可用类型：\n${typeDescriptions}`;

  return {
    declaration: {
      name: 'agent',
      description: toolDescription,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '交给子代理执行的任务描述，应尽量详细清晰',
          },
          agent_type: {
            type: 'string',
            description: '子代理类型（默认 general-purpose）',
       },
          mode: {
            type: 'string',
            description: '子代理运行模式（可选，影响提示词和可用工具集）',
          },
        },
        required: ['prompt'],
      },
    },
    handler: async (args) => {
      const prompt = args.prompt as string;
      const typeName = (args.agent_type as string) || 'general-purpose';
      const modeName = args.mode as string | undefined;

      // 深度检查
      if (currentDepth >= deps.maxDepth) {
        logger.warn(`子代理嵌套深度超限 (${currentDepth}/${deps.maxDepth})`);
        return { error: `子代理嵌套深度超过上限（${deps.maxDepth}），拒绝创建` };
      }

      // 获取类型配置
      const typeConfig = deps.agentTypes.get(typeName);
      if (!typeConfig) {
        return { error: `未知的子代理类型: ${typeName}。可用类型: ${deps.agentTypes.list().join(', ')}` };
      }

      // 构建子工具集（根据 AgentType 配置过滤）
      let subTools: ToolRegistry;
      if (typeConfig.allowedTools) {
        subTools = deps.tools.createSubset(typeConfig.allowedTools);
      } else if (typeConfig.excludedTools) {
        subTools = deps.tools.createFiltered(typeConfig.excludedTools);
      } else {
        subTools = deps.tools.createFiltered([]);
      }

      // 叠加模式过滤
      let subSystemPrompt = typeConfig.systemPrompt;
      if (modeName && deps.modeRegistry) {
        const modeConfig = deps.modeRegistry.get(modeName);
        if (modeConfig) {
          subTools = applyToolFilter(modeConfig, subTools);
          if (modeConfig.systemPrompt) {
            subSystemPrompt = modeConfig.systemPrompt + '\n\n' + subSystemPrompt;
          }
        } else {
          logger.warn(`子代理指定的模式 "${modeName}" 未找到，忽略`);
        }
      }

      // 注入深度递增的 agent 工具（实现真正的嵌套自我调用）
      if (currentDepth + 1 < deps.maxDepth) {
        subTools.unregister('agent');
        subTools.register(createAgentTool(deps, currentDepth + 1));
      }else {
        subTools.unregister('agent');
      }

      logger.info(`创建子代理: type=${typeName} mode=${modeName ?? 'none'} depth=${currentDepth + 1}/${deps.maxDepth} 工具数=${subTools.size}`);

      // 创建 ToolLoop（与 Orchestrator 复用同一引擎）
      const subPrompt = new PromptAssembler();
      subPrompt.setSystemPrompt(subSystemPrompt);

      const loop = new ToolLoop(subTools, subPrompt, {
        maxRounds: typeConfig.maxToolRounds,
      });

      const callLLM: LLMCaller = async (request, tier) => {
        const response = await deps.getRouter().chat(request, tier);
        return response.content;
      };

      try {
        const result = await loop.run(
          [{ role: 'user', parts: [{ text: prompt }] }],
          callLLM,
          { primaryTier: typeConfig.tier, secondaryTier: typeConfig.tier },
        );
        logger.info(`子代理完成: type=${typeName}`);
        return { result: result.text };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`子代理执行失败: ${errorMsg}`);
        return { error: `子代理执行失败: ${errorMsg}` };
      }
    },
  };
}
