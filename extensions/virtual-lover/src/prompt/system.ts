import type { LLMRequest, Part } from 'irises-extension-sdk';
import type { VirtualLoverInjectionMode } from '../config.js';

export function applyVirtualLoverSystemPrompt(
  request: LLMRequest,
  systemText: string,
  injectionMode: VirtualLoverInjectionMode,
): LLMRequest {
  const text = systemText.trim();
  if (!text) return request;

  const virtualLoverPart: Part = { text };
  const existingParts = request.systemInstruction?.parts ?? [];
  const parts = injectionMode === 'replace'
    ? [virtualLoverPart]
    : [virtualLoverPart, ...existingParts];

  return {
    ...request,
    systemInstruction: {
      ...request.systemInstruction,
      parts,
    },
  };
}
