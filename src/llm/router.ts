/**
 * LLM 三层路由器
 *
 * 按调用场景分配不同档次的 LLM Provider：
 *   - primary：用户主对话（工具循环第 1 轮）
 *   - secondary：工具循环后续轮次（第 2 轮起）
 *   - light：辅助任务（记忆/摘要等，预留）
 *
 * 回退链：light → secondary → primary
 */

import { LLMProvider } from './providers/base';
import { LLMRequest, LLMResponse, LLMStreamChunk } from '../types';

export type LLMTier = 'primary' | 'secondary' | 'light';

export interface LLMRouterConfig {
  primary: LLMProvider;
  secondary?: LLMProvider;
  light?: LLMProvider;
}

export class LLMRouter {
  private providers: LLMRouterConfig;

  constructor(config: LLMRouterConfig) {
    this.providers = config;
  }

  /** 按回退链解析实际 Provider */
  resolve(tier: LLMTier): LLMProvider {
    switch (tier) {
      case 'light':
        return this.providers.light ?? this.providers.secondary ?? this.providers.primary;
      case 'secondary':
        return this.providers.secondary ?? this.providers.primary;
      case 'primary':
      default:
        return this.providers.primary;
    }
  }

  /** 非流式调用（带层级） */
  async chat(request: LLMRequest, tier: LLMTier = 'primary'): Promise<LLMResponse> {
    return this.resolve(tier).chat(request);
  }

  /** 流式调用（带层级） */
  async *chatStream(request: LLMRequest, tier: LLMTier = 'primary'): AsyncGenerator<LLMStreamChunk> {
    yield* this.resolve(tier).chatStream(request);
  }

  /** 返回 primary 的名称（用于日志和状态展示） */
  get name(): string {
    return this.providers.primary.name;
  }

  /** 返回各层级状态信息 */
  getTierInfo(): Record<LLMTier, string | null> {
    return {
      primary: this.providers.primary.name,
      secondary: this.providers.secondary?.name ?? null,
      light: this.providers.light?.name ?? null,
    };
  }
}
