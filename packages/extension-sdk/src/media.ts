/**
 * 媒体处理 & OCR 服务的插件侧类型定义
 */

import type { DocumentInput } from './platform.js';

// ── 多模态输入类型（预留） ──

/** 音频输入（预留，供 onProcessUserMedia hook 使用） */
export interface AudioInput {
  mimeType: string;
  data: string;
  fileName?: string;
  /** 时长（秒） */
  duration?: number;
}

/** 视频输入（预留，供 onProcessUserMedia hook 使用） */
export interface VideoInput {
  mimeType: string;
  data: string;
  fileName?: string;
  /** 时长（秒） */
  duration?: number;
}

// ── 图片缩放 ──

/** 图片缩放选项 */
export interface ImageResizeOptions {
  /** 最大宽度（默认 2000） */
  maxWidth?: number;
  /** 最大高度（默认 2000） */
  maxHeight?: number;
  /** 最大字节数（默认 4.5MB，低于 Anthropic 的 5MB 限制） */
  maxBytes?: number;
  /** JPEG 质量（默认 80） */
  jpegQuality?: number;
}

/** 缩放后的图片结果 */
export interface ResizedImage {
  /** base64 编码的图片数据 */
  data: string;
  /** 输出 MIME 类型（可能从 PNG 转为 JPEG 或反之） */
  mimeType: string;
  /** 原始宽度 */
  originalWidth: number;
  /** 原始高度 */
  originalHeight: number;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 是否进行了缩放 */
  wasResized: boolean;
}

// ── 文档提取 ──

/** 文档文本提取结果 */
export interface ExtractedDocument {
  fileName: string;
  text: string;
  success: boolean;
  error?: string;
}

// ── 媒体服务接口 ──

/**
 * 媒体处理服务。
 * 插件通过 `api.media` 访问，可复用宿主已有的图片缩放、文档解析、Office→PDF 转换能力。
 */
export interface MediaServiceLike {
  /** 将图片缩放到 API 尺寸/大小限制以内。已在限制内时直接返回原图。 */
  resizeImage(mimeType: string, base64Data: string, options?: ImageResizeOptions): Promise<ResizedImage>;
  /** 为缩放过的图片生成坐标映射说明（未缩放时返回 undefined） */
  formatDimensionNote(result: ResizedImage): string | undefined;
  /** 从文档中提取文本。支持 PDF / DOCX / PPTX / XLSX / 常见文本文件。 */
  extractDocument(doc: DocumentInput): Promise<ExtractedDocument>;
  /** 检查指定 MIME 类型（或文件名扩展名）是否支持文档提取 */
  isSupportedDocumentMime(mimeType: string, fileName?: string): boolean;
  /** 将 Office 文档（DOCX/PPTX/XLSX）转换为 PDF。失败或不可用时返回 null。 */
  convertToPDF(buffer: Buffer, ext: string): Promise<Buffer | null>;
  /** 检查 Office→PDF 转换是否可用（需要 LibreOffice + libreoffice-convert 包） */
  isConversionAvailable(): boolean;
}

// ── OCR 服务接口 ──

/**
 * OCR 服务接口。
 * @deprecated OCR 功能已迁移至 multimodal 扩展，通过 onProcessUserMedia hook 实现。
 * 保留此接口仅为向后兼容。
 */
export interface OCRProviderLike {
  /** 从图片中提取文字 */
  extractText(mimeType: string, base64Data: string): Promise<string>;
}
