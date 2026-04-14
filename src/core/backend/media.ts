/**
 * 用户消息多模态内容的兜底处理
 *
 * 当没有扩展通过 onProcessUserMedia hook 接管处理时，
 * 后端使用此模块提供最基础的 Part 构建（原样存储，不做缩放/OCR/文档提取）。
 *
 * 完整的图片缩放、OCR、文档解析/转换等能力由 multimodal 扩展提供。
 */

import type { Part } from '../../types';
import type { ImageInput, DocumentInput } from './types';

/**
 * 将用户输入的文本、图片、文档转换为最基础的存储用 Part 数组。
 * 不做任何处理（不缩放、不 OCR、不提取文档文本），原样存储。
 */
export function buildMinimalParts(
  text: string,
  images: ImageInput[] | undefined,
  documents: DocumentInput[] | undefined,
): Part[] {
  const parts: Part[] = [];

  // 图片：原样存储
  if (Array.isArray(images)) {
    for (const image of images) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
  }

  // 文档：原样存储 + 文件名标签
  if (Array.isArray(documents)) {
    for (const doc of documents) {
      parts.push({ inlineData: { mimeType: doc.mimeType, data: doc.data } });
      parts.push({ text: `[Document: ${doc.fileName}]` });
    }
  }

  // 文本
  if (text.trim().length > 0) {
    parts.push({ text });
  }

  // 兜底空内容
  if (parts.length === 0) {
    parts.push({ text: '' });
  }

  return parts;
}
