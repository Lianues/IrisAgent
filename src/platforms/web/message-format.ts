/**
 * Web 平台消息格式化工具
 *
 * 将内部 Content / Part 结构转换为前端可直接消费的消息格式。
 */

import { isOCRTextPart } from '../../ocr';
import { Content, isTextPart, isThoughtTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart } from '../../types';
import { isDocumentMimeType } from '../../llm/vision';

export interface WebMessagePart {
  type: 'text' | 'thought' | 'image' | 'document' | 'function_call' | 'function_response'
  text?: string
  durationMs?: number
  mimeType?: string
  data?: string
  fileName?: string
  name?: string
  args?: unknown
  response?: unknown
  callId?: string
}

export interface WebMessageMeta {
  tokenIn?: number
  tokenOut?: number
  durationMs?: number
  streamOutputDurationMs?: number
  modelName?: string
}

export interface WebMessage {
  role: 'user' | 'model'
  parts: WebMessagePart[]
  meta?: WebMessageMeta
}

function extractDocumentMarkerFileName(text?: string): string | null {
  const normalized = text?.trim() ?? ''
  if (!normalized.startsWith('[Document: ')) return null

  const match = normalized.match(/^\[Document: ([^\]\r\n]+)\](?:$|\r?\n)/)
  return match?.[1]?.trim() || null
}

export function formatContent(content: Content): WebMessage {
  const formatted: WebMessage = { role: content.role, parts: [] }
  const pendingDocumentIndices: number[] = []

  // 提取性能元数据
  const meta: WebMessageMeta = {}
  if (content.usageMetadata?.promptTokenCount != null) meta.tokenIn = content.usageMetadata.promptTokenCount
  if (content.usageMetadata?.candidatesTokenCount != null) meta.tokenOut = content.usageMetadata.candidatesTokenCount
  if (content.durationMs != null) meta.durationMs = content.durationMs
  if (content.streamOutputDurationMs != null) meta.streamOutputDurationMs = content.streamOutputDurationMs
  if (content.modelName) meta.modelName = content.modelName
  if (Object.keys(meta).length > 0) formatted.meta = meta

  for (const part of content.parts) {
    if (isOCRTextPart(part)) {
      continue
    }

    if (isThoughtTextPart(part)) {
      if (part.text?.trim()) {
        formatted.parts.push({ type: 'thought', text: part.text, durationMs: part.thoughtDurationMs })
      }
      continue
    }

    if (isTextPart(part)) {
      const fileName = extractDocumentMarkerFileName(part.text)
      if (fileName && pendingDocumentIndices.length > 0) {
        const targetIndex = pendingDocumentIndices.shift()
        if (typeof targetIndex === 'number' && formatted.parts[targetIndex]?.type === 'document') {
          formatted.parts[targetIndex].fileName = fileName
        }
      }
      formatted.parts.push({ type: 'text', text: part.text })
      continue
    }

    if (isInlineDataPart(part)) {
      if (isDocumentMimeType(part.inlineData.mimeType)) {
        formatted.parts.push({
          type: 'document',
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        })
        pendingDocumentIndices.push(formatted.parts.length - 1)
      } else {
        formatted.parts.push({
          type: 'image',
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        })
      }
      continue
    }

    if (isFunctionCallPart(part)) {
      formatted.parts.push({
        type: 'function_call',
        name: part.functionCall.name,
        args: part.functionCall.args,
        callId: part.functionCall.callId,
      })
      continue
    }

    if (isFunctionResponsePart(part)) {
      formatted.parts.push({
        type: 'function_response',
        name: part.functionResponse.name,
        response: part.functionResponse.response,
        callId: part.functionResponse.callId,
      })
    }
  }

  return formatted
}

export function formatMessages(contents: Content[]): WebMessage[] {
  return contents.map(formatContent)
}
