/**
 * remote-shell.ts
 *
 * 一些纯 POSIX shell 工具函数：
 *   - 安全引号
 *   - base64 编解码用于在 shell 里安全传输任意二进制/多行文本
 *   - JSON 输出包装：远端命令以 \`echo "<JSON>"\` 形式吐回结果，本地 parse
 *
 * 设计原则：所有翻译器尽量用一个 \`bash -c\` 命令把整件事做完，
 * 输出**一行 JSON**到 stdout，错误信息到 stderr，exitCode 表示成败。
 * 这样 transport 层完全不需要懂业务，只负责 exec。
 */

/** POSIX 单引号引用：把字符串安全包进 '...' */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 把任意 utf-8 字符串编码为 base64，并构造一段在远端解码到变量的 shell 片段。
 * 结果片段执行后，`$1`（或指定变量名）即为原始内容。
 *
 * 用法：
 *   const cmd = `${b64ToVar(content, 'CONTENT')}; printf %s "$CONTENT" > target.txt`;
 */
export function b64ToVar(content: string, varName = 'DATA'): string {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  // base64 -d 在 GNU/BSD 都支持；macOS 上是 base64 -D，但绝大多数发行版的 base64 也接受 -d
  return `${varName}="$(printf %s ${shQuote(b64)} | base64 -d)"`;
}

/**
 * 包装一段 bash 脚本：让它输出一行带前缀标记的 JSON。
 * 这样翻译器解析时可以鲁棒地从混杂输出（warning / motd 等）中切出 JSON。
 *
 * 远端约定：
 *   __REMOTE_EXEC_JSON__<one-line-json>
 */
export const JSON_MARKER = '__REMOTE_EXEC_JSON__';

export function emitJsonLine(jsExpr: string): string {
  // jsExpr 应是一段 bash，结尾产生 JSON 字符串到 stdout
  return `printf '%s' '${JSON_MARKER}'; ${jsExpr}; printf '\\n'`;
}

/** 从远端 stdout 中提取 JSON_MARKER 标记的那一行 */
export function extractJsonLine(stdout: string): string | null {
  const idx = stdout.lastIndexOf(JSON_MARKER);
  if (idx < 0) return null;
  const afterMarker = stdout.slice(idx + JSON_MARKER.length);
  // 取到下一个换行为止
  const nl = afterMarker.indexOf('\n');
  return nl < 0 ? afterMarker : afterMarker.slice(0, nl);
}

/** 把 cwd 注入命令开头：cd <cwd> && <cmd> */
export function withCwd(command: string, cwd?: string): string {
  if (!cwd) return command;
  return `cd ${shQuote(cwd)} && ${command}`;
}
