/**
 * OpenAI Compatible Provider
 *
 * 适用于所有 OpenAI 兼容接口（OpenAI、DeepSeek、本地模型等）。
 */

import { LLMProvider } from './base';
import { OpenAICompatibleFormat } from '../formats/openai-compatible';

export interface OpenAICompatibleProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): LLMProvider {
  const model = config.model || 'gpt-4o';
  const baseUrl = config.baseUrl || 'https://api.openai.com';

  return new LLMProvider(
    new OpenAICompatibleFormat(model),
    {
      url: `${baseUrl}/v1/chat/completions`,
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    },
    'OpenAICompatible',
  );
}
