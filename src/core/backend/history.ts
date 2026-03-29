/**
 * 历史消息的 LLM 预处理
 *
 * 将存储中的原始历史消息转换为 LLM 可消费的格式，包括：
 * - 从最后一条总结消息开始截取
 * - 图片/文档根据模型能力剥离或保留
 * - OCR 文本标记处理
 * - Computer Use 旧截图清理
 */

import type { LLMConfig } from '../../config/types';
import { supportsVision as llmSupportsVision, isDocumentMimeType, supportsNativePDF, supportsNativeOffice } from '../../llm/vision';
import { isOCRTextPart, stripOCRTextMarker } from '../../ocr';
import type { Content, Part } from '../../types';
import { isFunctionCallPart, isFunctionResponsePart, isInlineDataPart, isTextPart } from '../../types';
import { IMAGE_UNAVAILABLE_NOTICE, DOCUMENT_UNAVAILABLE_NOTICE } from './types';

/** Computer Use 工具函数名集合（用于截图剥离判断） */
const COMPUTER_USE_FUNCTION_NAMES = new Set([
  'get_screenshot', 'click_at', 'hover_at', 'type_text_at',
  'scroll_document', 'scroll_at', 'key_combination', 'navigate',
  'go_back', 'go_forward', 'search', 'wait_5_seconds', 'drag_and_drop',
]);

/**
 * 将存储的完整历史转换为 LLM 请求所用的历史。
 * - 从最后一条 isSummary 消息开始加载
 * - 对每条消息的 parts 调用 preparePartsForLLM 进行清理
 * - 剥离旧的 Computer Use 截图
 */
export function prepareHistoryForLLM(
  history: Content[],
  currentLLMConfig?: LLMConfig,
  maxRecentScreenshots: number = 3,
): Content[] {
  // 从最后一条总结消息开始加载上下文，跳过更早的历史
  let startIndex = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].isSummary) {
      startIndex = i;
      break;
    }
  }
  const relevantHistory = startIndex > 0 ? history.slice(startIndex) : history;

  const prepared = relevantHistory.map((content) => ({
    role: content.role,
    parts: preparePartsForLLM(content.parts, currentLLMConfig),
    usageMetadata: content.usageMetadata,
    durationMs: content.durationMs,
    streamOutputDurationMs: content.streamOutputDurationMs,
  }));

  // Computer Use 截图清理：只保留最近 N 轮含截图的工具响应，
  // 超出的旧轮次中把 functionResponse.parts（截图）剥离以节省 token。
  // 与 Gemini 官方示例的处理逻辑一致。
  stripOldScreenshots(prepared, maxRecentScreenshots);

  return prepared;
}

/**
 * 对单条消息的 Parts 进行 LLM 投喂前的清理：
 * - 非 vision 模型剥离图片 inlineData，补充不可用提示
 * - OCR 文本在非 vision 模式下去除标记前缀
 * - 文档按端点能力保留或剥离
 * - functionCall/functionResponse 深拷贝
 */
export function preparePartsForLLM(parts: Part[], currentLLMConfig?: LLMConfig): Part[] {
  const visionEnabled = llmSupportsVision(currentLLMConfig);
  const prepared: Part[] = [];
  let strippedImageCount = 0;
  let strippedDocumentCount = 0;
  let hasOCRContext = false;

  for (const part of parts) {
    if (isOCRTextPart(part)) {
      hasOCRContext = true;
      if (!visionEnabled && part.text) {
        prepared.push({ ...part, text: stripOCRTextMarker(part.text) });
      }
      continue;
    }

    if (isInlineDataPart(part)) {
      const mime = part.inlineData.mimeType;
      if (isDocumentMimeType(mime)) {
        // 文档 InlineDataPart：按端点能力决定保留或剥离
        if (mime === 'application/pdf' && supportsNativePDF(currentLLMConfig)) {
          prepared.push({ inlineData: { ...part.inlineData } });
        } else if (mime !== 'application/pdf' && supportsNativeOffice(currentLLMConfig)) {
          prepared.push({ inlineData: { ...part.inlineData } });
        } else {
          strippedDocumentCount++;
        }
      } else {
        // 图片 InlineDataPart：现有逻辑
        if (visionEnabled) {
          prepared.push({ inlineData: { ...part.inlineData } });
        } else {
          strippedImageCount++;
        }
      }
      continue;
    }

    if (isFunctionCallPart(part)) {
      prepared.push({
        functionCall: {
          name: part.functionCall.name,
          args: JSON.parse(JSON.stringify(part.functionCall.args ?? {})),
          callId: part.functionCall.callId,
        },
      });
      continue;
    }

    if (isFunctionResponsePart(part)) {
      prepared.push({
        functionResponse: {
          name: part.functionResponse.name,
          response: JSON.parse(JSON.stringify(part.functionResponse.response ?? {})),
          callId: part.functionResponse.callId,
          // 保留工具结果中的多模态内联数据（截图、音频等）
          ...(part.functionResponse.parts
            ? { parts: part.functionResponse.parts.map(p => ({ inlineData: { ...p.inlineData } })) }
            : {}),
        },
      });
      continue;
    }

    if (isTextPart(part)) {
      prepared.push({
        ...part,
        thoughtSignatures: part.thoughtSignatures ? { ...part.thoughtSignatures } : undefined,
      });
      continue;
    }

    const _exhaustive: never = part;
    void _exhaustive;
  }

  if (!visionEnabled && strippedImageCount > 0 && !hasOCRContext) {
    prepared.unshift({ text: IMAGE_UNAVAILABLE_NOTICE(strippedImageCount) });
  }
  if (strippedDocumentCount > 0) {
    prepared.unshift({ text: DOCUMENT_UNAVAILABLE_NOTICE(strippedDocumentCount) });
  }

  if (prepared.length === 0) {
    prepared.push({ text: '' });
  }

  return prepared;
}

/**
 * 从历史末尾向前扫描，保留最近 max 轮含 Computer Use 截图
 * 的工具响应，超出部分把 functionResponse.parts 置空。
 * 直接修改传入的数组，不产生新对象。
 */
function stripOldScreenshots(history: Content[], max: number): void {
  if (max === Infinity) return;  // 全部保留

  let screenshotTurns = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i];
    if (content.role !== 'user') continue;

    // 检查此 user 轮是否包含带截图的 Computer Use 工具响应
    const hasCUScreenshot = content.parts.some(
      p => isFunctionResponsePart(p)
        && p.functionResponse.parts?.length
        && COMPUTER_USE_FUNCTION_NAMES.has(p.functionResponse.name),
    );
    if (!hasCUScreenshot) continue;

    screenshotTurns++;
    if (screenshotTurns > max) {
      // 剥离此轮中所有 Computer Use 工具响应的截图
      for (const part of content.parts) {
        if (isFunctionResponsePart(part)
          && part.functionResponse.parts?.length
          && COMPUTER_USE_FUNCTION_NAMES.has(part.functionResponse.name)) {
          part.functionResponse.parts = undefined;
        }
      }
    }
  }
}
