/**
 * 轻量子 Agent 执行器
 *
 * 简化版 Orchestrator，拥有独立上下文和工具循环。
 * 不包含：平台适配器、持久化存储、流式输出、记忆注入。
 */

import { LLMRouter, LLMTier } from '../llm/router';
import { ToolRegistry } from '../tools/registry';
import { PromptAssembler } from '../prompt/assembler';
import { createLogger } from '../logger';
import {
  Content, Part,
  isFunctionCallPart, isTextPart,
  FunctionCallPart, FunctionResponsePart,
} from '../types';

const logger = createLogger('AgentExecutor');

export class AgentExecutor {
  private router: LLMRouter;
  private tools: ToolRegistry;
  private prompt: PromptAssembler;
  private tier: LLMTier;
  private maxToolRounds: number;

  constructor(
    router: LLMRouter,
    tools: ToolRegistry,
    systemPrompt: string,
    tier: LLMTier,
    maxToolRounds: number,
  ) {
    this.router = router;
    this.tools = tools;
    this.tier = tier;
    this.maxToolRounds = maxToolRounds;

    this.prompt = new PromptAssembler();
    this.prompt.setSystemPrompt(systemPrompt);
  }

  /** 执行子 Agent 任务，返回最终文本结果 */
  async execute(userPrompt: string): Promise<string> {
    // 内存历史（不持久化）
    const history: Content[] = [
      { role: 'user', parts: [{ text: userPrompt }] },
    ];

    let rounds = 0;
    while (rounds < this.maxToolRounds) {
      rounds++;

      // 组装请求
      const toolDecls = this.tools.getDeclarations();
      const request = this.prompt.assemble(history, toolDecls);

      // 非流式调用 LLM
      const response = await this.router.chat(request, this.tier);
      const modelContent = response.content;

      // 存入历史
      history.push(modelContent);

      // 检查工具调用
      const functionCalls = modelContent.parts.filter(isFunctionCallPart);

      if (functionCalls.length === 0) {
        // 无工具调用，提取文本返回
        const text = modelContent.parts.filter(isTextPart).map(p => p.text).join('');
        return text || '（子代理未返回文本）';
      }

      // 并行执行工具
      const responseParts = await this.executeTools(functionCalls);
      history.push({ role: 'user', parts: responseParts });
    }

    logger.warn(`子代理工具轮次超过上限 (${this.maxToolRounds})`);
    return `子代理工具执行轮次超过上限（${this.maxToolRounds}），已中断。`;
  }

  /** 并行执行工具调用 */
  private async executeTools(functionCalls: FunctionCallPart[]): Promise<Part[]> {
    const responseParts = await Promise.all(
      functionCalls.map(async (call): Promise<FunctionResponsePart> => {
        const name = call.functionCall.name;
        logger.info(`子代理执行工具: ${name}`);
        try {
          const result = await this.tools.execute(
            name,
            call.functionCall.args as Record<string, unknown>,
          );
          return {
            functionResponse: {
              name,
              response: { result } as Record<string, unknown>,
            },
          };
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(`子代理工具执行失败: ${name}:`, errorMsg);
          return {
            functionResponse: {
              name,
              response: { error: errorMsg },
            },
          };
        }
      })
    );
    return responseParts;
  }
}
