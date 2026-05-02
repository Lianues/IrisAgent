/**
 * @deprecated OCR 配置已迁移到 multimodal 扩展。
 *
 * 保留该兼容入口，供旧测试/旧调用方继续解析 ocr.yaml。
 * 当前核心不再消费 OCR 配置，因此这里仅返回一个浅拷贝对象。
 */
export function parseOCRConfig(raw?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return { ...raw };
}
