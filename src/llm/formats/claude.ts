/**
 * Claude/Anthropic 格式适配器
 *
 * Gemini ↔ Claude API 格式的完整双向转换。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part, FunctionCallPart,
  isTextPart, isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { consumeCallId, normalizeCallId, resolveCallId } from './tool-call-ids';

export class ClaudeFormat implements FormatAdapter {
  constructor(private model: string) {}

  // ============ 编码请求：Gemini → Claude ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const body: Record<string, unknown> = { model: this.model };

    // systemInstruction → system 字符串
    if (request.systemInstruction?.parts) {
      const text = request.systemInstruction.parts
        .filter(isVisibleTextPart).map(p => p.text).join('\n');
      if (text) body.system = text;
    }

    // contents → messages
    const messages: Record<string, unknown>[] = [];
    const pendingToolUseIds: string[] = [];
    let generatedToolUseIdCounter = 0;

    for (const content of request.contents) {
      const textParts = content.parts.filter(isVisibleTextPart);
      const funcCallParts = content.parts.filter(isFunctionCallPart);
      const funcRespParts = content.parts.filter(isFunctionResponsePart);

      if (content.role === 'model') {
        const contentBlocks: Record<string, unknown>[] = [];

        // 思考部分 (Claude Thinking) — 必须在 text 之前
        const thoughtPart = content.parts.find(p => (p as any).thought && (p as any).thoughtSignatures?.claude);
        if (thoughtPart) {
          const sig = (thoughtPart as any).thoughtSignatures.claude;
          const thinkingText = (thoughtPart as any).text || '';
          contentBlocks.push({ type: 'thinking', thinking: thinkingText, signature: sig });
        }

        // 文本部分
        for (const part of textParts) {
          if (!isTextPart(part)) continue;
          if (part.text) contentBlocks.push({ type: 'text', text: part.text });
        }

        // 工具调用部分
        for (const part of funcCallParts) {
          if (!isFunctionCallPart(part)) continue;
          const toolUseId = resolveCallId(part.functionCall.callId, `toolu_${generatedToolUseIdCounter++}`);
          contentBlocks.push({
            type: 'tool_use',
            id: toolUseId,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
          pendingToolUseIds.push(toolUseId);
        }

        if (contentBlocks.length > 0) {
          messages.push({ role: 'assistant', content: contentBlocks });
        }
      } else {
        // user role
        if (funcRespParts.length > 0) {
          const contentBlocks: Record<string, unknown>[] = [];
          for (const part of funcRespParts) {
            if (!isFunctionResponsePart(part)) continue;
            const toolUseId = consumeCallId({
              explicit: part.functionResponse.callId,
              pendingCallIds: pendingToolUseIds,
              providerLabel: 'Claude',
              toolName: part.functionResponse.name,
            });
            contentBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify(part.functionResponse.response),
            });
          }
          messages.push({ role: 'user', content: contentBlocks });
        } else {
          const contentBlocks: Record<string, unknown>[] = [];
          let hasInlineImage = false;

          for (const part of content.parts) {
            if (isTextPart(part) && part.thought !== true && part.text) {
              contentBlocks.push({ type: 'text', text: part.text });
            } else if (isInlineDataPart(part)) {
              hasInlineImage = true;
              const mime = part.inlineData.mimeType;
              if (mime === 'application/pdf') {
                contentBlocks.push({
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mime,
                    data: part.inlineData.data,
                  },
                });
              } else {
                contentBlocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mime,
                    data: part.inlineData.data,
                  },
                });
              }
            }
          }

          if (hasInlineImage) {
            messages.push({ role: 'user', content: contentBlocks });
          } else {
            const text = textParts.map(p => {
              if (!isTextPart(p)) throw new Error('unreachable');
              return p.text;
            }).join('');
            messages.push({ role: 'user', content: text });
          }
        }
      }
    }

    body.messages = messages;

    // tools 声明转换
    if (request.tools && request.tools.length > 0) {
      const allDecls = request.tools.flatMap(t => t.functionDeclarations);
      body.tools = allDecls.map(decl => ({
        name: decl.name,
        description: decl.description,
        input_schema: decl.parameters,
      }));
    }

    // generationConfig 转换（Claude 要求必填 max_tokens）
    const gc = request.generationConfig;
    body.max_tokens = gc?.maxOutputTokens ?? 16000;
    if (gc?.temperature !== undefined) body.temperature = gc.temperature;
    if (gc?.topP !== undefined) body.top_p = gc.topP;
    if (gc?.topK !== undefined) body.top_k = gc.topK;

    // 流式参数
    if (stream) body.stream = true;

    return body;
  }

  // ============ 解码响应：Claude → Gemini ============

  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    const parts: Part[] = [];

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input,
              callId: normalizeCallId(block.id),
            },
          });
        } else if (block.type === 'thinking') {
          // Claude thinking block: { type: "thinking", thinking: "思考文本", signature: "签名" }
          parts.push({
            text: block.thinking || '',
            thought: true,
            thoughtSignatures: { claude: block.signature },
          });
        }
      }
    }
    if (parts.length === 0) parts.push({ text: '' });

    // stop_reason 映射
    const finishReason = mapStopReason(data.stop_reason);

    return {
      content: { role: 'model', parts },
      finishReason,
      usageMetadata: data.usage
        ? {
            promptTokenCount: data.usage.input_tokens,
            candidatesTokenCount: data.usage.output_tokens,
            totalTokenCount: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const chunk: LLMStreamChunk = {};
    const st = state as ClaudeStreamState;

    switch (data.type) {
      case 'message_start':
        // message_start 事件中包含 input_tokens
        if (data.message?.usage) {
          st.inputTokens = data.message.usage.input_tokens ?? 0;
          if (data.message.usage.cache_read_input_tokens) {
            st.cacheReadInputTokens = data.message.usage.cache_read_input_tokens;
          }
        }
        break;

      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          st.currentToolUse = {
            id: data.content_block.id,
            name: data.content_block.name,
            arguments: '',
          };
        } else if (data.content_block?.type === 'thinking') {
          // 标记进入 thinking block
          st.inThinkingBlock = true;
        }
        break;

      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          chunk.textDelta = data.delta.text;
        } else if (data.delta?.type === 'thinking_delta') {
          // Claude thinking 流式文本：delta.thinking 包含可读的思考文本
          chunk.partsDelta = [{
            text: data.delta.thinking || '',
            thought: true,
          } as any];
        } else if (data.delta?.type === 'signature_delta') {
          // Claude thinking 签名：在 thinking block 结束前发送
          // 仅存签名，不含文本，用于多轮回传
          chunk.partsDelta = [{
            thought: true,
            thoughtSignatures: { claude: data.delta.signature },
          } as any];
          if (!chunk.thoughtSignatures) chunk.thoughtSignatures = {};
          chunk.thoughtSignatures.claude = data.delta.signature;
        } else if (data.delta?.type === 'input_json_delta') {
          if (st.currentToolUse) {
            st.currentToolUse.arguments += data.delta.partial_json;
          }
        }
        break;

      case 'content_block_stop':
        if (st.currentToolUse) {
          st.pendingFunctionCalls.push({
            functionCall: {
              name: st.currentToolUse.name,
              args: st.currentToolUse.arguments
                ? JSON.parse(st.currentToolUse.arguments)
                : {},
              callId: st.currentToolUse.id,
            },
          });
          st.currentToolUse = null;
        }
        if (st.inThinkingBlock) {
          st.inThinkingBlock = false;
        }
        break;

      case 'message_delta':
        if (data.delta?.stop_reason) {
          chunk.finishReason = mapStopReason(data.delta.stop_reason);
          // 输出累积的工具调用
          if (st.pendingFunctionCalls.length > 0) {
            chunk.functionCalls = [...st.pendingFunctionCalls];
            st.pendingFunctionCalls = [];
          }
        }
        if (data.usage) {
          chunk.usageMetadata = {
            promptTokenCount: st.inputTokens ?? 0,
            candidatesTokenCount: data.usage.output_tokens,
            totalTokenCount: (st.inputTokens ?? 0) + (data.usage.output_tokens ?? 0),
          };
        }
        break;

      // ping 等事件忽略
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      currentToolUse: null,
      pendingFunctionCalls: [],
      inputTokens: 0,
      inThinkingBlock: false,
    } as ClaudeStreamState;
  }
}

interface ClaudeStreamState extends StreamDecodeState {
  currentToolUse: { id: string; name: string; arguments: string } | null;
  pendingFunctionCalls: FunctionCallPart[];
  inputTokens: number;
  cacheReadInputTokens?: number;
  inThinkingBlock: boolean;
}

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'end_turn': return 'STOP';
    case 'tool_use': return 'TOOL_CALLS';
    case 'max_tokens': return 'MAX_TOKENS';
    case 'stop_sequence': return 'STOP';
    default: return reason ?? 'STOP';
  }
}
