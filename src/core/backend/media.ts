/**
 * 用户消息多模态内容的兜底处理
 *
 * 当没有扩展通过 onProcessUserMedia hook 接管处理时，
 * 后端使用此模块提供最基础的 Part 构建（原样存储，不做缩放/OCR/文档提取）。
 *
 * 完整的图片缩放、OCR、文档解析/转换等能力由 multimodal 扩展提供。
 */

import type { Part } from '../../types';
import { isInlineDataPart } from '../../types';
import type { ImageInput, DocumentInput, AudioInput, VideoInput } from './types';

/**
 * 将用户输入的文本、图片、文档转换为最基础的存储用 Part 数组。
 * 不做任何处理（不缩放、不 OCR、不提取文档文本），原样存储。
 */
export function buildMinimalParts(
  text: string,
  images: ImageInput[] | undefined,
  documents: DocumentInput[] | undefined,
  audio?: AudioInput[],
  video?: VideoInput[],
): Part[] {
  const parts: Part[] = [];

  // 图片：原样存储
  if (Array.isArray(images)) {
    for (const image of images) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data, name: image.fileName } });
    }
  }

  // 文档：原样存储（文件名存入 name 字段）
  if (Array.isArray(documents)) {
    for (const doc of documents) {
      parts.push({ inlineData: { mimeType: doc.mimeType, data: doc.data, name: doc.fileName } });
    }
  }
  // 音频：原样存储
  if (Array.isArray(audio)) {
    for (const a of audio) {
      parts.push({ inlineData: { mimeType: a.mimeType, data: a.data, name: a.fileName } });
    }
  }

  // 视频：原样存储
  if (Array.isArray(video)) {
    for (const v of video) {
      parts.push({ inlineData: { mimeType: v.mimeType, data: v.data, name: v.fileName } });
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

// ============ 多模态 Token 估算 ============

/**
 * 估算 Parts 数组中多模态内容的 token 数。
 *
 * 基于 Gemini API 的多模态 tokenization 规则：
 * - 图片：两边 <=384px → 258 tokens；否则按 768x768 瓦片拆分，每块 258 tokens
 * - 音频：32 tokens/秒
 * - 视频：263 tokens/秒
 * - 文档（PDF 等）：按页估算，每页约 258 tokens（与图片类似）
 *
 * 由于无法在不解码的情况下获取图片尺寸和音视频时长，
 * 这里使用基于文件大小的启发式估算：
 * - 图片：小于 100KB 视为小图（258 tokens），否则按面积估算瓦片数
 * - 音频：按大小估算时长（假设 128kbps 平均码率）
 * - 视频：按大小估算时长（假设 2Mbps 平均码率）
 * - 文档：小文件 258 tokens，大文件按页数估算
 */
export function estimateMultimodalTokens(parts: Part[]): number {
  let tokens = 0;

  for (const part of parts) {
    if (!isInlineDataPart(part)) continue;

    const mime = part.inlineData.mimeType || '';
    // base64 数据大小 → 原始字节数（base64 膨胀 ~4/3）
    const rawBytes = Math.floor((part.inlineData.data?.length || 0) * 3 / 4);

    if (mime.startsWith('image/')) {
      // 图片 token 估算
      // 小图（<100KB，大致对应 384x384 以下）→ 258 tokens
      // 大图 → 按文件大小估算瓦片数：典型 768x768 JPEG 瓦片 ≈ 200-400KB
      if (rawBytes < 100 * 1024) {
        tokens += 258;
      } else {
        const estimatedTiles = Math.max(1, Math.ceil(rawBytes / (300 * 1024)));
        tokens += estimatedTiles * 258;
      }
    } else if (mime.startsWith('audio/')) {
      // 音频：32 tokens/秒，假设平均 128kbps = 16KB/s
      const estimatedSeconds = rawBytes / (16 * 1024);
      tokens += Math.max(32, Math.ceil(estimatedSeconds * 32));
    } else if (mime.startsWith('video/')) {
      // 视频：263 tokens/秒，假设平均 2Mbps = 256KB/s
      const estimatedSeconds = rawBytes / (256 * 1024);
      tokens += Math.max(263, Math.ceil(estimatedSeconds * 263));
    } else {
      // 文档（PDF 等）：按页估算
      // 典型 PDF 页面 ≈ 50-200KB，每页 ≈ 258 tokens
      const estimatedPages = Math.max(1, Math.ceil(rawBytes / (100 * 1024)));
      tokens += estimatedPages * 258;
    }
  }

  return tokens;
}
