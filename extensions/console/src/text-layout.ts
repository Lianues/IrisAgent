/**
 * Console 平台文本布局工具。
 *
 * 提供 grapheme 切分和宽字符宽度计算。
 * 输入栏已改用 OpenTUI 内置组件，大部分光标计算函数已移除。
 */

/**
 * 检测是否处于 CJK 环境。
 * CJK 终端通常将 EA Width Ambiguous 字符按全宽 (2 格) 渲染。
 */
const IS_CJK_LOCALE: boolean = (() => {
  const lang = (process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE || '').toLowerCase();
  return /^(zh|ja|ko|zh_|ja_|ko_)/.test(lang)
    || lang.includes('.gb')     // GB2312 / GBK / GB18030
    || lang.includes('.euc')    // EUC-JP / EUC-KR
    || lang.includes('.big5')   // Big5
    || lang.includes('.shift'); // Shift_JIS
})();

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part: any) => part.segment as string);
  }
  return Array.from(text);
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F
    || codePoint === 0x2329
    || codePoint === 0x232A
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (IS_CJK_LOCALE && codePoint >= 0x2580 && codePoint <= 0x259F) // Block Elements — EA Width Ambiguous, CJK only
    || (IS_CJK_LOCALE && codePoint >= 0x25A0 && codePoint <= 0x25FF) // Geometric Shapes — EA Width Ambiguous, CJK only
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;

  let width = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }

  return width || 1;
}

export function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((total, grapheme) => total + getGraphemeWidth(grapheme), 0);
}

export function getLineLength(text: string): number {
  return splitGraphemes(text).length;
}
