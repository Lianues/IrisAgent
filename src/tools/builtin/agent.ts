/**
 * Agent 工具 —— 派生子代理执行复杂子任务
 *
 * 主 LLM 通过此工具创建独立的子 Agent，
 * 每个子 Agent 拥有独立上下文、独立工具集、独立工具循环。
 */

import { ToolDefinition } from '../../types';
import { LLMRouter } from '../../llm/router';
import { ToolRegistry } from '../registry';
import { AgentTypeRegistry } from '../../core/agent-types';
import { AgentExecutor } from '../../core/agent-executor';
import { createLogger } from '../../logger';

const logger = createLogger('AgentTool');

export interface AgentToolDeps {
  /** 动态获取 router（支持热重载后取到最新实例） */
  getRouter: () => LLMRouter;
  tools: ToolRegistry;
  agentTypes: AgentTypeRegistry;
  maxDepth: number;
}

/**
 * 创建 agent 工具
 *
 * @param deps        依赖注入
 * @param currentDepth 当前嵌套深度（0 = 顶层，由主 Orchestrator 调用）
 */
export function createAgentTool(deps: AgentToolDeps, currentDepth: number = 0): ToolDefinition {
  // 构建包含各类型说明的详细描述
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
        },
        required: ['prompt'],
      },
    },
    handler: async (args) => {
      const prompt = args.prompt as string;
      const typeName = (args.agent_type as string) || 'general-purpose';

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

      // 构建子工具集
      let subTools: ToolRegistry;
      if (typeConfig.allowedTools) {
        // 白名单模式
        subTools = deps.tools.createSubset(typeConfig.allowedTools);
      } else if (typeConfig.excludedTools) {
        // 黑名单模式
        subTools = deps.tools.createFiltered(typeConfig.excludedTools);
      } else {
        // 默认排除 agent 工具防止递归
        subTools = deps.tools.createFiltered(['agent']);
      }

      logger.info(`创建子代理: type=${typeName} depth=${currentDepth + 1}/${deps.maxDepth} 工具数=${subTools.size}`);

      // 创建并执行子 Agent
      const executor = new AgentExecutor(
        deps.getRouter(),
        subTools,
        typeConfig.systemPrompt,
        typeConfig.tier,
        typeConfig.maxToolRounds,
      );

      try {
        const result = await executor.execute(prompt);
        logger.info(`子代理完成: type=${typeName}`);
        return { result };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`子代理执行失败: ${errorMsg}`);
        return { error: `子代理执行失败: ${errorMsg}` };
      }
    },
  };
}
