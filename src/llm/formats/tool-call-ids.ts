/**
 * 工具调用 ID 辅助函数
 *
 * 在内部统一消息结构中，用 callId 表示各 provider 的工具调用标识：
 * - OpenAI Chat Completions: tool_call.id
 * - OpenAI Responses: function_call.call_id
 * - Claude: tool_use.id
 */

export function normalizeCallId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveCallId(explicit: unknown, fallback: string): string {
  return normalizeCallId(explicit) ?? fallback;
}

export function consumeCallId(params: {
  explicit: unknown;
  pendingCallIds: string[];
  providerLabel: string;
  toolName: string;
}): string {
  const explicitId = normalizeCallId(params.explicit);
  if (explicitId) {
    const matchedIndex = params.pendingCallIds.indexOf(explicitId);
    if (matchedIndex >= 0) {
      params.pendingCallIds.splice(matchedIndex, 1);
    }
    return explicitId;
  }

  const nextPendingId = params.pendingCallIds.shift();
  if (nextPendingId) return nextPendingId;

  const toolName = params.toolName || '(unknown tool)';
  throw new Error(`${params.providerLabel} 工具响应缺少 callId，且无法从历史函数调用推断：${toolName}`);
}
