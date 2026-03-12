/**
 * OpenAI Responses 格式适配器
 *
 * 专门处理 /v1/responses 接口。
 * 支持 reasoning summary 存储为 thought parts，
 * 支持 encrypted_content 存储为 thoughtSignatures.openai 并回传。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part, FunctionCallPart,
  isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart, isTextPart,
} from '../../types';
import { isDocumentMimeType } from '../vision';
import { FormatAdapter, StreamDecodeState } from './types';

export class OpenAIResponsesFormat implements FormatAdapter {
  constructor(private model: string) {}

  // ============ 编码请求：Gemini (Internal) → OpenAI Responses ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const body: Record<string, any> = {
      model: this.model,
      store: false,
      contains: ['reasoning.encrypted_content'],
    };

    // 1. systemInstruction -> instructions
    if (request.systemInstruction?.parts) {
      body.instructions = request.systemInstruction.parts
        .filter(isVisibleTextPart)
        .map(p => p.text)
        .join('\n');
    }

    // 2. contents -> input
    const inputItems: any[] = [];
    let toolUseIdCounter = 0;

    for (const content of request.contents) {
      if (content.role === 'model') {
        let currentMessageItem: any = null;

        for (const part of content.parts) {
          if (isTextPart(part) && part.thought === true) {
            const reasoningItem: any = { type: 'reasoning' };
            if (part.text) {
              reasoningItem.summary = [{ type: 'summary_text', text: part.text }];
            }
            if (part.thoughtSignatures?.openai) {
              reasoningItem.encrypted_content = part.thoughtSignatures.openai;
            }
            inputItems.push(reasoningItem);
            currentMessageItem = null;
          } else if (isVisibleTextPart(part) && part.text) {
            if (!currentMessageItem) {
              currentMessageItem = { type: 'message', role: 'assistant', content: [] };
              inputItems.push(currentMessageItem);
            }
            currentMessageItem.content.push({ type: 'output_text', text: part.text });
          } else if (isFunctionCallPart(part)) {
            inputItems.push({
              id: `call_${toolUseIdCounter++}`,
              type: 'function_call',
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            });
            currentMessageItem = null;
          }
        }
      } else {
        const funcRespParts = content.parts.filter(isFunctionResponsePart);
        if (funcRespParts.length > 0) {
          const firstCallIndex = toolUseIdCounter - funcRespParts.length;
          for (let i = 0; i < funcRespParts.length; i++) {
            const part = funcRespParts[i];
            if (!isFunctionResponsePart(part)) continue;
            inputItems.push({
              type: 'function_call_output',
              call_id: `call_${firstCallIndex + i}`,
              output: JSON.stringify(part.functionResponse.response),
            });
          }
        } else {
          const contentBlocks: any[] = [];
          for (const part of content.parts) {
            if (isTextPart(part) && part.thought !== true && part.text) {
              contentBlocks.push({ type: 'input_text', text: part.text });
            } else if (isInlineDataPart(part)) {
              const mime = part.inlineData.mimeType;
              if (isDocumentMimeType(mime)) {
                contentBlocks.push({
                  type: 'input_file',
                  file_data: `data:${mime};base64,${part.inlineData.data}`,
                });
              } else {
                contentBlocks.push({
                  type: 'input_image',
                  image_url: `data:${mime};base64,${part.inlineData.data}`,
                });
              }
            }
          }
          if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'input_text', text: ' ' });
          }
          inputItems.push({
            role: 'user',
            content: contentBlocks,
          });
        }
      }
    }

    body.input = inputItems;

    // 3. tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.flatMap(t => t.functionDeclarations).map(decl => ({
        type: 'function',
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters,
      }));
    }

    // 4. generationConfig
    if (request.generationConfig) {
      const gc = request.generationConfig;
      if (gc.maxOutputTokens !== undefined) body.max_output_tokens = gc.maxOutputTokens;
      if (gc.temperature !== undefined) body.temperature = gc.temperature;
      if (gc.topP !== undefined) body.top_p = gc.topP;
    }

    if (stream) body.stream = true;

    return body;
  }

  // ============ 解码响应：OpenAI Responses → Gemini (Internal) ============

  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    if (!data.output) {
      throw new Error(`OpenAI Responses API 未返回有效内容: ${JSON.stringify(data)}`);
    }

    const parts: Part[] = [];
    for (const item of data.output) {
      if (item.type === 'reasoning') {
        const part = createReasoningPart(item, { includeText: true, includeSignature: true });
        if (part) parts.push(part);
      } else if (item.type === 'message') {
        for (const block of item.content ?? []) {
          if (block.type === 'output_text') {
            parts.push({ text: block.text });
          }
        }
      } else if (item.type === 'function_call') {
        parts.push(createFunctionCallPart(item));
      }
    }

    if (parts.length === 0) parts.push({ text: '' });

    return {
      content: { role: 'model', parts },
      usageMetadata: data.usage ? {
        promptTokenCount: data.usage.input_tokens,
        candidatesTokenCount: data.usage.output_tokens,
        totalTokenCount: data.usage.total_tokens,
      } : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const chunk: LLMStreamChunk = {};
    const streamState = state as OpenAIResponsesStreamState;
    const event = data.event || data.type;

    if (event === 'response.output_text.delta') {
      if (data.delta) {
        chunk.textDelta = data.delta;
        chunk.partsDelta = [{ text: data.delta }];
      }
    } else if (event === 'response.output_item.added') {
      const item = data.item;
      if (item?.type === 'reasoning') {
        const part = createReasoningPart(item, { includeText: true, includeSignature: true });
        if (part) {
          chunk.partsDelta = [part];
          if ('thoughtSignatures' in part && part.thoughtSignatures) {
            chunk.thoughtSignatures = { ...part.thoughtSignatures };
          }
        }
      } else if (item?.type === 'function_call') {
        emitFunctionCallChunk(chunk, item, streamState);
      }
    } else if (event === 'response.output_item.done') {
      const item = data.item;
      if (item?.type === 'reasoning' && item.encrypted_content) {
        const part = createReasoningPart(item, { includeText: false, includeSignature: true });
        if (part) {
          chunk.partsDelta = [part];
          if ('thoughtSignatures' in part && part.thoughtSignatures) {
            chunk.thoughtSignatures = { ...part.thoughtSignatures };
          }
        }
      } else if (item?.type === 'function_call') {
        emitFunctionCallChunk(chunk, item, streamState);
      }
    } else if (event === 'response.completed') {
      if (data.usage) {
        chunk.usageMetadata = {
          promptTokenCount: data.usage.input_tokens,
          candidatesTokenCount: data.usage.output_tokens,
          totalTokenCount: data.usage.total_tokens,
        };
      }
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      emittedFunctionCallIds: new Set<string>(),
    } as OpenAIResponsesStreamState;
  }
}

interface OpenAIResponsesStreamState extends StreamDecodeState {
  emittedFunctionCallIds: Set<string>;
}

function createReasoningPart(
  item: any,
  options: { includeText: boolean; includeSignature: boolean },
): Part | undefined {
  const part: any = { thought: true };

  if (options.includeText) {
    const text = extractReasoningSummaryText(item.summary);
    if (text) part.text = text;
  }

  if (options.includeSignature && item.encrypted_content) {
    part.thoughtSignatures = { openai: item.encrypted_content };
  }

  return part.text || part.thoughtSignatures ? part : undefined;
}

function extractReasoningSummaryText(summary: unknown): string {
  if (!Array.isArray(summary)) return '';
  return summary
    .map(item => (item && typeof item === 'object' && 'text' in item ? (item as any).text : ''))
    .filter(Boolean)
    .join('\n');
}

function createFunctionCallPart(item: any): FunctionCallPart {
  return {
    functionCall: {
      name: item.name,
      args: parseFunctionCallArguments(item.arguments),
    },
  };
}

function parseFunctionCallArguments(argumentsValue: unknown): Record<string, unknown> {
  if (!argumentsValue) return {};
  if (typeof argumentsValue === 'string') {
    return JSON.parse(argumentsValue);
  }
  if (typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
    return argumentsValue as Record<string, unknown>;
  }
  return {};
}

function emitFunctionCallChunk(
  chunk: LLMStreamChunk,
  item: any,
  state: OpenAIResponsesStreamState,
): void {
  const functionCall = tryCreateFunctionCallPart(item);
  if (!functionCall) return;

  const itemId = String(item.id ?? `${item.name}:${JSON.stringify(item.arguments ?? {})}`);
  if (state.emittedFunctionCallIds.has(itemId)) return;
  state.emittedFunctionCallIds.add(itemId);

  chunk.functionCalls = [...(chunk.functionCalls ?? []), functionCall];
  chunk.partsDelta = [...(chunk.partsDelta ?? []), functionCall];
}

function tryCreateFunctionCallPart(item: any): FunctionCallPart | undefined {
  if (item.arguments === undefined) return undefined;
  try {
    return createFunctionCallPart(item);
  } catch {
    return undefined;
  }
}
