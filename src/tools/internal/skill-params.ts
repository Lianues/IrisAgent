/**
 * Skill 参数替换引擎
 *
 * 支持 $ARGUMENTS（完整参数字符串）、$0/$1（位置参数）、
 * $name（命名参数）的单次替换，防止二次展开。
 */

export interface ParsedSkillArguments {
  /** 原始完整参数字符串 */
  raw: string;
  /** 按空格分割的位置参数 */
  positional: string[];
  /** 命名参数映射 */
  named: Record<string, string>;
}

/**
 * 解析参数字符串为位置参数和命名参数。
 *
 * 位置参数：按空格分割（支持引号包裹含空格的值）。
 * 命名参数：根据 skill 声明的 namedKeys 列表，按位置顺序映射。
 *
 * 例：namedKeys = ['file', 'branch']，args = 'src/main.ts dev'
 * → positional = ['src/main.ts', 'dev']
 * → named = { file: 'src/main.ts', branch: 'dev' }
 */
export function parseSkillArguments(raw: string, namedKeys?: string[]): ParsedSkillArguments {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw: '', positional: [], named: {} };
  }

  // 简易引号感知的分割：支持 "arg with spaces" 和 'arg with spaces'
  const positional: string[] = [];
  const regex = /("([^"]*)")|('([^']*)')|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    // 取引号内的内容，或者非空白 token
    positional.push(match[2] ?? match[4] ?? match[5] ?? '');
  }

  // 命名参数：按位置顺序映射到 namedKeys
  const named: Record<string, string> = {};
  if (namedKeys) {
    for (let i = 0; i < namedKeys.length && i < positional.length; i++) {
      named[namedKeys[i]] = positional[i];
    }
  }

  return { raw: trimmed, positional, named };
}

/**
 * 在 skill content 中执行参数替换。
 *
 * 替换优先级（单次 pass，防止二次展开）：
 *   1. $ARGUMENTS → 完整参数字符串
 *   2. $0, $1, ... → 对应位置参数（越界时替换为空字符串）
 *   3. $name → 与 namedKeys 中声明的命名参数匹配
 *
 * 如果 content 中没有任何占位符且 args.raw 非空，
 * 则将参数追加到末尾。
 */
export function substituteSkillParams(
  content: string,
  args: ParsedSkillArguments,
  namedKeys?: string[],
): string {
  if (!args.raw) return content;

  const keySet = new Set(namedKeys ?? []);
  let hasPlaceholder = false;

  // 单次正则替换，匹配所有 $ARGUMENTS / $数字 / $标识符 模式
  // 未匹配的 $xxx 保持原样
  const result = content.replace(
    /\$(?:ARGUMENTS|\d+|[a-zA-Z_][a-zA-Z0-9_]*)/g,
    (match) => {
      if (match === '$ARGUMENTS') {
        hasPlaceholder = true;
        return args.raw;
      }

      // $数字 → 位置参数
      const digitMatch = match.match(/^\$(\d+)$/);
      if (digitMatch) {
        hasPlaceholder = true;
        const idx = parseInt(digitMatch[1], 10);
        return args.positional[idx] ?? '';
      }

      // $name → 命名参数
      const name = match.slice(1); // 去掉 $
      if (keySet.has(name) && name in args.named) {
        hasPlaceholder = true;
        return args.named[name];
      }

      // 未识别的 $xxx，保持原样
      return match;
    },
  );

  // 无占位符时追加参数到末尾
  if (!hasPlaceholder) {
    return result + `\n\nARGUMENTS: ${args.raw}`;
  }

  return result;
}
