/**
 * 核心协调器
 *
 * 串联所有模块，管理完整的消息处理流程：
 *   用户消息→ 存储 → ToolLoop（LLM + 工具循环） → 存储 → 回复用户
 *
 * 协调器本身只负责 I/O 编排（平台、存储、流式输出、记忆），
 * 核心计算循环委托给 ToolLoop。
 */

import { PlatformAdapter } from '../platforms/base';
import { LLMRouter, LLMTier } from '../llm/router';
import { StorageProvider } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { PromptAssembler } from '../prompt/assembler';
import {MemoryProvider } from '../memory/base';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../modes';
import { ToolLoop, ToolLoopConfig, LLMCaller } from './tool-loop';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest, UsageMetadata,
  isFunctionCallPart, isTextPart,
  FunctionCallPart,
} from '../types';

const logger = createLogger('Orchestrator');

export interface OrchestratorConfig {
  /** 工具执行最大轮次（防止无限循环） */
  maxToolRounds?: number;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 是否自动召回记忆（默认 true） */
  autoRecall?: boolean;
  /** Agent 协调指导文本 */
  agentGuidance?: string;
  /** 默认模式名称 */
  defaultMode?: string;
}

export class Orchestrator {
  private platform: PlatformAdapter;
  private router: LLMRouter;
  private storage: StorageProvider;
  private tools: ToolRegistry;
  private prompt: PromptAssembler;
  private stream: boolean;
  private autoRecall: boolean;
  private agentGuidance?: string;
  private memory?: MemoryProvider;
  private modeRegistry?: ModeRegistry;
  private defaultMode?: string;

  /** 核心工具循环实例 */
  private toolLoop: ToolLoop;
  /** ToolLoop 配置（可变引用，支持热重载） */
  private toolLoopConfig: ToolLoopConfig;

  constructor(
    platform: PlatformAdapter,
    router: LLMRouter,
    storage: StorageProvider,
    tools: ToolRegistry,
    toolState: ToolStateManager,
    prompt: PromptAssembler,
    config?: OrchestratorConfig,
    memory?: MemoryProvider,
    modeRegistry?: ModeRegistry,
  ) {
    this.platform = platform;
    this.router = router;
    this.storage = storage;
    this.tools = tools;
    this.prompt = prompt;
    this.stream = config?.stream ?? false;
    this.autoRecall = config?.autoRecall ?? true;
    this.agentGuidance = config?.agentGuidance;
    this.memory = memory;
    this.modeRegistry = modeRegistry;
    this.defaultMode = config?.defaultMode;

    // 创建 ToolLoop（配置对象保留引用，热重载时可直接修改）
    this.toolLoopConfig = { maxRounds: config?.maxToolRounds ?? 10 };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);
  }

  /** 启动：注册消息回调并启动平台 */
  async start(): Promise<void> {
    this.platform.onMessage(async (msg) => {
      try {
        await this.handleMessage(msg.sessionId, msg.parts);
      } catch (err) {
        logger.error(`处理消息失败 (session=${msg.sessionId}):`, err);
        try {
          const errorText = err instanceof Error ? err.message : String(err);
          await this.platform.sendMessage(msg.sessionId, `发生错误: ${errorText}`);
        } catch {
          // 发送错误消息也失败，只记录日志
        }
      }
    });

    this.platform.setToolStateManager(this.toolLoop['toolState']!);

    this.platform.onClear(async (sessionId) => {
      await this.storage.clearHistory(sessionId);
    });

    await this.platform.start();
    const mode = this.stream ? '流式' : '非流式';
    const tierInfo = this.router.getTierInfo();
    const tierDesc = [
      `primary=${tierInfo.primary}`,
      tierInfo.secondary ? `secondary=${tierInfo.secondary}` : null,
      tierInfo.light ? `light=${tierInfo.light}` : null,
    ].filter(Boolean).join(' ');
    logger.info(`已启动 | 平台=${this.platform.name} LLM=[${tierDesc}] 模式=${mode} 工具数=${this.tools.size}`);
  }

  /** 停止 */
  async stop(): Promise<void> {
    await this.platform.stop();
    logger.info('已停止');
  }

  /** 热重载：替换 LLM 路由器 */
  reloadLLM(newRouter: LLMRouter): void {
    this.router = newRouter;
    const tierInfo = newRouter.getTierInfo();
    const tierDesc = [
      `primary=${tierInfo.primary}`,
      tierInfo.secondary ? `secondary=${tierInfo.secondary}` : null,
      tierInfo.light ? `light=${tierInfo.light}` : null,
    ].filter(Boolean).join(' ');
    logger.info(`LLM 已热重载: [${tierDesc}]`);
  }

  /** 热重载：更新运行时参数 */
  reloadConfig(opts: { stream?: boolean; maxToolRounds?: number; systemPrompt?: string }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds}`);
  }

  /** 获取路由器引用 */
  getRouter(): LLMRouter {
    return this.router;
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, userParts: Part[]): Promise<void> {
    // 1. 加载历史并追加用户消息
    const history = await this.storage.getHistory(sessionId);
    const historyLenBefore = history.length;
    history.push({ role: 'user', parts: userParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    // 记忆自动召回
    if (this.memory && this.autoRecall) {
      try {
        const userText = userParts.filter(isTextPart).map(p => p.text).join('');
        const context = await this.memory.buildContext(userText);
        if (context) {
          extraParts = [{ text: context }];
        }
      } catch (err) {
        logger.warn('查询记忆失败:', err);
      }
    }

    // Agent 协调指导
    if (this.agentGuidance) {
      if (!extraParts) extraParts = [];
      extraParts.push({ text: this.agentGuidance });
    }

    // 模式提示词覆盖
    const mode = this.resolveMode();
    if (mode?.systemPrompt) {
      if (!extraParts) extraParts = [];
      extraParts.unshift({ text: mode.systemPrompt });
    }

    // 3. 构建 LLM 调用函数（注入流式/非流式行为）
    const callLLM: LLMCaller = async (request, tier) => {
      if (this.stream) {
        const result = await this.callLLMStream(sessionId, request, tier);
        return result.content;
      } else {
        const response = await this.router.chat(request, tier);
        const content = response.content;
        if (response.usageMetadata) {
          content.usageMetadata = response.usageMetadata;
        }
        return content;
      }
    };

    // 4. 解析模式工具过滤（创建临时 ToolLoop 或使用默认）
    let loop = this.toolLoop;
    if (mode?.tools) {
      const filteredTools = applyToolFilter(mode, this.tools);
      loop = new ToolLoop(filteredTools, this.prompt, this.toolLoopConfig, this.toolLoop['toolState']);
    }

    // 5. 执行工具循环
    const result = await loop.run(history, callLLM, { extraParts });

    // 6. 持久化新增消息
    for (let i = historyLenBefore; i < result.history.length; i++) {
      await this.storage.addMessage(sessionId, result.history[i]);
    }

    // 7. 发送最终文本（非流式模式）
    if (!this.stream && result.text) {
      await this.platform.sendMessage(sessionId, result.text);
    }
  }

  // ============ 流式调用 ============

  /**
   * 流式调用 LLM：边接收边输出文本，同时累积完整的 Content。
   */
  private async callLLMStream(
    sessionId: string,
    request: LLMRequest,
    tier: LLMTier = 'primary',
  ): Promise<{ content: Content }> {
    let fullText = '';
    const collectedCalls: FunctionCallPart[] = [];
    let usageMetadata: UsageMetadata | undefined;
    let thoughtSignature: string | undefined;

    const llmStream = this.router.chatStream(request, tier);

    const textStream = (async function* () {
      for await (const chunk of llmStream) {
        if (chunk.textDelta) {
          fullText += chunk.textDelta;
          yield chunk.textDelta;
        }
        if (chunk.functionCalls) collectedCalls.push(...chunk.functionCalls);
        if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
        if (chunk.thoughtSignature) thoughtSignature = chunk.thoughtSignature;
      }
    })();

    await this.platform.sendMessageStream(sessionId, textStream);

    const parts: Part[] = [];
    if (fullText) {
      const textPart: any = { text: fullText };
      if (thoughtSignature) textPart.thoughtSignature = thoughtSignature;
      parts.push(textPart);
    }
    parts.push(...collectedCalls.map(c => thoughtSignature ? { ...c, thoughtSignature } as any : c));
    if (parts.length === 0) parts.push({ text: '' });

    const content: Content = { role: 'model', parts };
    if (usageMetadata) content.usageMetadata = usageMetadata;

    return { content };
  }

  // ============ 模式解析 ============

  private resolveMode(): ModeDefinition | undefined {
    if (!this.defaultMode || !this.modeRegistry) return undefined;
    return this.modeRegistry.get(this.defaultMode);
  }
}
