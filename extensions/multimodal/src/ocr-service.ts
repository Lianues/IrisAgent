/**
 * OCR 服务 — 通过 LLM vision 模型从图片中提取文字
 *
 * 使用 SDK 的 LLMRouterLike.chat() 调用 vision 模型，
 * 不依赖宿主内部的 LLM provider 实现。
 */

import type { LLMRouterLike, LLMRequest, Part, TextPart } from 'irises-extension-sdk';

const OCR_TEXT_MARKER_RE = /^\[\[IRIS_OCR_IMAGE_(\d+)\]\]\n/;
const OCR_PROMPT = '请详细描述图片内容，优先完整、准确地提取其中所有可见文字；若存在段落、表格、列表或表单，请尽量保持原有结构。若图片中没有文字，再简要描述主要视觉内容。';
const OCR_EMPTY_TEXT = '（OCR 未提取到可识别内容）';

export interface OCRConfig {
  /** OCR 使用的模型名称（需已在 LLM 路由中注册），不填则使用当前活跃模型 */
  model?: string;
}

/**
 * OCR 服务实例。
 * 通过 LLM router 调用 vision 模型提取图片文字。
 */
export class OCRService {
  private router: LLMRouterLike;
  private modelName?: string;

  constructor(router: LLMRouterLike, config?: OCRConfig) {
    this.router = router;
    this.modelName = config?.model;
  }

  async extractText(mimeType: string, base64Data: string): Promise<string> {
    const request: LLMRequest = {
      contents: [{
        role: 'user',
        parts: [
          { text: OCR_PROMPT },
          { inlineData: { mimeType, data: base64Data } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
      },
    };

    const response = await this.router.chat!(request, this.modelName);
    // 从 response 提取文本
    const parts = (response as any)?.content?.parts ?? [];
    const text = parts
      .filter((p: any) => typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('');
    return text.trim() || OCR_EMPTY_TEXT;
  }
}

// ── OCR 标记工具函数 ──

export function createOCRTextPart(index: number, text: string): TextPart {
  const normalized = text.trim() || OCR_EMPTY_TEXT;
  return {
    text: `[[IRIS_OCR_IMAGE_${index}]]\n[图片${index}内容]\n${normalized}`,
  };
}

export function isOCRTextValue(text: string | undefined): boolean {
  return typeof text === 'string' && OCR_TEXT_MARKER_RE.test(text);
}

export function isOCRTextPart(part: Part): boolean {
  return typeof (part as any)?.text === 'string' && isOCRTextValue((part as any).text);
}

export function stripOCRTextMarker(text: string): string {
  return text.replace(OCR_TEXT_MARKER_RE, '');
}
