/**
 * Multimodal 扩展 — 多模态处理插件
 *
 * 通过 onProcessUserMedia hook 为用户消息提供完整的多模态处理能力：
 * - 图片自动缩放（sharp）
 * - OCR 文字提取（vision 模型回退）
 * - 文档文本提取（PDF/DOCX/PPTX/XLSX）
 * - Office→PDF 转换（LibreOffice）
 *
 * 通过 onBeforeLLMCall hook 在 LLM 调用前按模型能力清洗历史中的 OCR 标记。
 */

import {
  definePlugin,
  createPluginLogger,
} from 'irises-extension-sdk';
import type {
  PluginContext,
  IrisAPI,
  ImageInput,
  DocumentInput,
  Part,
  LLMRequest,
  Content,
  LLMRouterLike,
} from 'irises-extension-sdk';

import { resizeImage, formatDimensionNote } from './image-resize.js';
import { extractDocument, isSupportedDocumentMime } from './document-extract.js';
import type { ExtractedDocument } from './document-extract.js';
import { convertToPDF, isConversionAvailable } from './office-to-pdf.js';
import { OCRService, createOCRTextPart, isOCRTextPart, stripOCRTextMarker } from './ocr-service.js';

const logger = createPluginLogger('multimodal');

// ── 文档 MIME 判断（本地复制，避免依赖宿主内部模块） ──

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function isDocumentMimeType(mime: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mime);
}

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

// ── 文档回退文本提取 ──

async function extractDocumentFallback(doc: DocumentInput, parts: Part[]): Promise<void> {
  try {
    const result: ExtractedDocument = await extractDocument(doc);
    if (result.success) {
      parts.push({ text: `[Document: ${doc.fileName}]\n${result.text}` });
    } else {
      logger.warn(`文档提取失败 (${doc.fileName}): ${result.error}`);
      parts.push({ text: `[Document: ${doc.fileName}] 提取失败: ${result.error}` });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`文档处理异常 (${doc.fileName}): ${detail}`);
    parts.push({ text: `[Document: ${doc.fileName}] 处理异常: ${detail}` });
  }
}

// ── 插件状态 ──

/** multimodal.yaml 默认配置模板 */
const DEFAULT_CONFIG_TEMPLATE = `# 多模态处理配置
#
# 本扩展为 Iris 提供图片缩放、OCR 文字提取、文档解析等多模态处理能力。
# 删除整个文件或注释掉所有字段即可使用默认设置。

# ── OCR 配置（可选） ──
#
# 当主模型不支持图片输入（supportsVision: false）时，
# 扩展会调用 vision 模型提取图片中的文字，再把提取结果作为文本注入上下文。
#
# 何时需要配置：
#   - 主模型是纯文本模型，但用户会上传图片
#   - 主模型本身支持图片输入时，通常不需要配置 OCR
#
# 注释掉 ocr 段落即可关闭 OCR 回退。
# 关闭后，不支持图片的模型会收到"无法查看图片内容"的占位提示。

# ocr:
#   model: gpt-4o-mini   # 推荐使用轻量 vision 模型，成本低、速度快
`;

interface MultimodalConfig {
  ocr?: {
    model?: string;
    enabled?: boolean;
  };
}

let ocrService: OCRService | undefined;
let cachedApi: IrisAPI | undefined;

// ── 插件定义 ──

export default definePlugin({
  name: 'multimodal',
  version: '0.1.0',
  description: '多模态处理 — 图片缩放、OCR、文档提取、Office→PDF 转换',

  activate(ctx: PluginContext) {
    // 1. 释放默认配置模板
    ctx.ensureConfigFile('multimodal.yaml', DEFAULT_CONFIG_TEMPLATE);

    // 2. 读取配置（优先 multimodal.yaml，兼容旧 ocr.yaml）
    const rawConfig = ctx.readConfigSection('multimodal') as MultimodalConfig | undefined;
    let ocrConfig = rawConfig?.ocr;

    // 向后兼容：如果没有 multimodal.yaml 中的 ocr 配置，尝试读取旧的 ocr.yaml
    if (!ocrConfig) {
      const legacyOcr = ctx.readConfigSection('ocr') as Record<string, unknown> | undefined;
      if (legacyOcr && typeof legacyOcr === 'object' && ('model' in legacyOcr || 'apiKey' in legacyOcr)) {
        ocrConfig = { model: legacyOcr.model as string | undefined };
        logger.info('已从旧 ocr.yaml 迁移 OCR 配置');
      }
    }

    // 注册 onProcessUserMedia hook — 处理用户多模态输入
    ctx.addHook({
      name: 'multimodal:process-media',
      priority: 100,

      async onProcessUserMedia(params) {
        const { text, images, documents, capabilities } = params;
        const parts: Part[] = [];

        // ---- 图片处理 ----
        if (Array.isArray(images) && images.length > 0) {
          if (capabilities.supportsVision || !ocrService) {
            // Vision 模式或无 OCR：缩放后直传
            for (const image of images) {
              const resized = await resizeImage(image.mimeType, image.data);
              parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });
              if (capabilities.supportsVision) {
                const dimNote = formatDimensionNote(resized);
                if (dimNote) parts.push({ text: dimNote });
              }
            }
          } else {
            // OCR 回退模式：缩放 + OCR
            const resizedImages = await Promise.all(
              images.map(img => resizeImage(img.mimeType, img.data))
            );
            const ocrTexts = await Promise.all(
              resizedImages.map(async (resized, index) => {
                try {
                  return await ocrService!.extractText(resized.mimeType, resized.data);
                } catch (err) {
                  const detail = err instanceof Error ? err.message : String(err);
                  throw new Error(`OCR 处理第 ${index + 1} 张图片失败: ${detail}`);
                }
              })
            );
            for (let i = 0; i < resizedImages.length; i++) {
              const resized = resizedImages[i];
              parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });
              parts.push(createOCRTextPart(i + 1, ocrTexts[i]));
            }
          }
        }

        // ---- 文档处理 ----
        if (Array.isArray(documents) && documents.length > 0) {
          for (const doc of documents) {
            let effectiveMime = doc.mimeType;
            const ext = doc.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
            if (!isDocumentMimeType(effectiveMime) && ext in EXTENSION_TO_MIME) {
              effectiveMime = EXTENSION_TO_MIME[ext];
            }

            const isPdf = effectiveMime === 'application/pdf';
            const isOffice = isDocumentMimeType(effectiveMime) && !isPdf;

            if (isPdf && capabilities.supportsNativePDF) {
              parts.push({ inlineData: { mimeType: 'application/pdf', data: doc.data } });
              parts.push({ text: `[Document: ${doc.fileName}]` });
            } else if (isOffice && capabilities.supportsNativePDF) {
              const pdfBuffer = await convertToPDF(Buffer.from(doc.data, 'base64'), ext);
              if (pdfBuffer) {
                parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } });
                parts.push({ text: `[Document: ${doc.fileName}]` });
              } else if (capabilities.supportsNativeOffice) {
                parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
                parts.push({ text: `[Document: ${doc.fileName}]` });
              } else {
                await extractDocumentFallback(doc, parts);
              }
            } else if (isOffice && capabilities.supportsNativeOffice) {
              parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
              parts.push({ text: `[Document: ${doc.fileName}]` });
            } else {
              await extractDocumentFallback(doc, parts);
            }
          }
        }

        // ---- 文本 ----
        if (text.trim().length > 0) {
          parts.push({ text });
        }
        if (parts.length === 0) {
          parts.push({ text: '' });
        }

        return { parts };
      },

      // onBeforeLLMCall — 按模型能力清洗历史中的 OCR 标记
      onBeforeLLMCall(params) {
        const { request } = params;
        if (!request.contents) return undefined;

        // 判断当前模型是否支持 vision（通过 api 查询）
        const supportsVision = cachedApi?.supportsVision?.() ?? false;
        let changed = false;

        for (const msg of request.contents) {
          if (!Array.isArray(msg.parts)) continue;
          const cleaned: Part[] = [];
          for (const part of msg.parts) {
            if (isOCRTextPart(part)) {
              changed = true;
              if (!supportsVision && (part as any).text) {
                // 非 vision 模型：保留 OCR 文本但去掉标记前缀
                cleaned.push({ ...part, text: stripOCRTextMarker((part as any).text) });
              }
              // vision 模型：跳过 OCR 文本（模型直接看图）
              continue;
            }
            cleaned.push(part);
          }
          if (changed) {
            msg.parts = cleaned;
          }
        }

        return changed ? { request } : undefined;
      },
    });

    // onReady: 获取 API 引用，初始化 OCR 服务
    ctx.onReady((api: IrisAPI) => {
      cachedApi = api;

      // 初始化 OCR 服务
      if (ocrConfig && ocrConfig.enabled !== false && api.router?.chat) {
        ocrService = new OCRService(api.router as LLMRouterLike, {
          model: ocrConfig?.model,
        });
        logger.info(`OCR 服务已启用${ocrConfig.model ? ` (model: ${ocrConfig.model})` : ''}`);
      }

      // 注册 media 服务到 irisAPI（供其他插件使用）
      if (api.media === undefined) {
        (api as any).media = {
          resizeImage,
          formatDimensionNote,
          extractDocument,
          isSupportedDocumentMime,
          convertToPDF,
          isConversionAvailable,
        };
      }

      logger.info('多模态处理扩展已就绪');
    });
  },
});
