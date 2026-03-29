/**
 * 获取单个字符的终端显示宽度。
 * CJK 字符占 2 列，其余占 1 列。
 */
export function getCharacterDisplayWidth(char: string): number {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char)
    ? 2
    : 1
}

/**
 * 获取字符串的终端显示宽度。
 */
export function getStringDisplayWidth(str: string): number {
  let width = 0
  for (const char of str) {
    width += getCharacterDisplayWidth(char)
  }
  return width
}

/**
 * 将文本按终端显示宽度折行。
 * 每行不超过 maxWidth 个显示列。
 */
export function wrapTextByDisplayWidth(input: string, maxWidth: number): string[] {
  if (!input) return [""]
  if (maxWidth <= 0) return [input]

  const lines: string[] = []

  for (const rawLine of input.split(/\r?\n/)) {
    if (!rawLine) {
      lines.push("")
      continue
    }

    let current = ""
    let currentWidth = 0

    for (const char of rawLine) {
      const charWidth = getCharacterDisplayWidth(char)
      if (currentWidth + charWidth > maxWidth && current.length > 0) {
        lines.push(current)
        current = char
        currentWidth = charWidth
        continue
      }

      current += char
      currentWidth += charWidth
    }

    lines.push(current)
  }

  return lines.length > 0 ? lines : [""]
}
