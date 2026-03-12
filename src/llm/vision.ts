/**
 * Vision 能力检测 + 文档能力检测
 */

import type { LLMConfig } from '../config/types';

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/** 检查是否为文档 MIME 类型（PDF / DOCX / PPTX / XLSX） */
export function isDocumentMimeType(mimeType: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mimeType);
}

/** PDF 原生直传: Gemini, Claude, OpenAI Responses */
export function supportsNativePDF(config?: Pick<LLMConfig, 'provider'>): boolean {
  if (!config) return false;
  return config.provider === 'gemini' || config.provider === 'claude' || config.provider === 'openai-responses';
}

/** Office 原生直传: OpenAI Responses only */
export function supportsNativeOffice(config?: Pick<LLMConfig, 'provider'>): boolean {
  if (!config) return false;
  return config.provider === 'openai-responses';
}

const VISION_PATTERNS = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /gemini/i,
  /claude-3/i,
  /claude-sonnet-4/i,
  /claude-opus-4/i,
  /qwen.*vl/i,
  /glm-4v/i,
  /minicpm-v/i,
  /pixtral/i,
  /llava/i,
  /(?:^|[-_/])vision(?:[-_/]|$)/i,
];

export function supportsVision(config?: Pick<LLMConfig, 'model' | 'supportsVision'>): boolean {
  if (!config) return false;
  if (typeof config.supportsVision === 'boolean') {
    return config.supportsVision;
  }
  return VISION_PATTERNS.some((pattern) => pattern.test(config.model ?? ''));
}
