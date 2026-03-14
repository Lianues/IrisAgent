/**
 * Markdown 渲染组件
 *
 * 使用 marked.lexer() 将 Markdown 解析为 token 树，
 * 再将各 token 映射为 Ink React 组件。
 *
 * 块级：标题、代码块、引用、有序/无序列表、分隔线、表格、段落
 * 行内：粗体、斜体、行内代码、删除线、链接
 */

import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { marked } from 'marked';
import { highlight } from 'cli-highlight';

namespace Tokens {
  export interface Base {
    type: string;
    text?: string;
    tokens?: Token[];
  }

  export interface Text extends Base {
    type: 'text';
    text: string;
    tokens?: Token[];
  }

  export interface Strong extends Base {
    type: 'strong';
    tokens: Token[];
  }

  export interface Em extends Base {
    type: 'em';
    tokens: Token[];
  }

  export interface Codespan extends Base {
    type: 'codespan';
    text: string;
  }

  export interface Del extends Base {
    type: 'del';
    tokens: Token[];
  }

  export interface Link extends Base {
    type: 'link';
    href: string;
    text?: string;
    tokens?: Token[];
  }

  export interface Image extends Base {
    type: 'image';
    href: string;
    text: string;
  }

  export interface Br extends Base {
    type: 'br';
  }

  export interface Escape extends Base {
    type: 'escape';
    text: string;
  }

  export interface Heading extends Base {
    type: 'heading';
    depth: number;
    text: string;
    tokens: Token[];
  }

  export interface Paragraph extends Base {
    type: 'paragraph';
    tokens: Token[];
  }

  export interface Code extends Base {
    type: 'code';
    text: string;
    lang?: string;
  }

  export interface Blockquote extends Base {
    type: 'blockquote';
    tokens?: Token[];
  }

  export interface ListItem {
    task?: boolean;
    checked?: boolean;
    tokens: Token[];
  }

  export interface List extends Base {
    type: 'list';
    items: ListItem[];
    ordered?: boolean;
    start?: number;
  }

  export interface Hr extends Base {
    type: 'hr';
  }

  export interface TableCell {
    text: string;
    tokens: Token[];
  }

  export interface Table extends Base {
    type: 'table';
    header: TableCell[];
    rows: TableCell[][];
  }

  export interface HTML extends Base {
    type: 'html';
    text: string;
  }

  export interface Space extends Base {
    type: 'space';
  }

  export type Token =
    | Text
    | Strong
    | Em
    | Codespan
    | Del
    | Link
    | Image
    | Br
    | Escape
    | Heading
    | Paragraph
    | Code
    | Blockquote
    | List
    | Hr
    | Table
    | HTML
    | Space
    | Base;
}

type Token = Tokens.Token;

// ── 工具函数 ────────────────────────────────────────────

/**
 * 计算字符串在终端中的显示宽度。
 * CJK 及全角字符占 2 列，其余占 1 列。
 */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3040 && c <= 0x33bf) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff01 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x2fffd) ||
      (c >= 0x30000 && c <= 0x3fffd)
    ) { w += 2; } else { w += 1; }
  }
  return w;
}

/** marked lexer 在某些 token（如 codespan）中会转义 HTML 实体，此处反转义 */
function unescape(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── 行内 token 渲染 ────────────────────────────────────

function renderInline(tokens: Token[], kp = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const k = `${kp}${i}`;

    switch (t.type) {
      case 'text': {
        const tt = t as Tokens.Text;
        // Text token 可能有嵌套 tokens（如段落内的混合格式）
        if (tt.tokens && tt.tokens.length > 0) {
          out.push(<Text key={k}>{renderInline(tt.tokens, `${k}.`)}</Text>);
        } else {
          out.push(<Text key={k}>{unescape(tt.text)}</Text>);
        }
        break;
      }
      case 'strong': {
        const tt = t as Tokens.Strong;
        out.push(
          <Text key={k} bold color="white">{renderInline(tt.tokens, `${k}.`)}</Text>,
        );
        break;
      }
      case 'em': {
        const tt = t as Tokens.Em;
        out.push(
          <Text key={k} italic>{renderInline(tt.tokens, `${k}.`)}</Text>,
        );
        break;
      }
      case 'codespan': {
        const tt = t as Tokens.Codespan;
        out.push(
          <Text key={k} backgroundColor="gray" color="white">{` ${unescape(tt.text)} `}</Text>,
        );
        break;
      }
      case 'del': {
        const tt = t as Tokens.Del;
        out.push(
          <Text key={k} strikethrough dimColor>{renderInline(tt.tokens, `${k}.`)}</Text>,
        );
        break;
      }
      case 'link': {
        const tt = t as Tokens.Link;
        const label = tt.tokens?.length
          ? renderInline(tt.tokens, `${k}.`)
          : unescape(tt.text ?? tt.href);
        out.push(
          <Text key={k}>
            <Text color="cyan" underline>{label}</Text>
            {tt.href && <Text dimColor>{` (${tt.href})`}</Text>}
          </Text>,
        );
        break;
      }
      case 'image': {
        const tt = t as Tokens.Image;
        out.push(<Text key={k} dimColor>[image: {unescape(tt.text || tt.href)}]</Text>);
        break;
      }
      case 'br':
        out.push(<Text key={k}>{'\n'}</Text>);
        break;
      case 'escape':
        out.push(<Text key={k}>{(t as Tokens.Escape).text}</Text>);
        break;
      default: {
        // 未知行内 token：尝试递归 tokens 或渲染 text
        if (Array.isArray(t.tokens)) {
          out.push(<Text key={k}>{renderInline(t.tokens, `${k}.`)}</Text>);
        } else if (typeof t.text === 'string') {
          out.push(<Text key={k}>{unescape(t.text)}</Text>);
        }
        break;
      }
    }
  }

  return out;
}

// ── 块级 token 渲染 ────────────────────────────────────

const HEADING_COLORS: Record<number, string> = {
  1: 'yellow',
  2: 'cyan',
  3: 'green',
  4: 'white',
  5: 'white',
  6: 'white',
};

/**
 * 渲染单个块级 token。
 * @param cursor  可选的流式光标节点，追加在最后一个 token 的末尾。
 */
function renderBlock(
  token: Token,
  key: string,
  termWidth: number,
  cursor?: React.ReactNode,
): React.ReactNode {
  switch (token.type) {
    // ── 标题 ──
    case 'heading': {
      const t = token as Tokens.Heading;
      const color = HEADING_COLORS[t.depth] ?? 'white';

      if (t.depth <= 2) {
        // H1: ═══ 双线  H2: ─── 单线
        const lineChar = t.depth === 1 ? '═' : '─';
        const lineWidth = Math.max(displayWidth(unescape(t.text)), 4);
        return (
          <Box key={key} flexDirection="column">
            <Text bold color={color} wrap="wrap">
              {renderInline(t.tokens, `${key}.`)}
              {cursor}
            </Text>
            <Text dimColor color={color}>{lineChar.repeat(lineWidth)}</Text>
          </Box>
        );
      }

      // H3+ 保持 # 前缀
      return (
        <Box key={key}>
          <Text bold color={color} wrap="wrap">
            {'#'.repeat(t.depth)} {renderInline(t.tokens, `${key}.`)}
            {cursor}
          </Text>
        </Box>
      );
    }

    // ── 段落 ──
    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      return (
        <Box key={key}>
          <Text wrap="wrap">
            {renderInline(t.tokens, `${key}.`)}
            {cursor}
          </Text>
        </Box>
      );
    }

    // ── 代码块 ──
    case 'code': {
      const t = token as Tokens.Code;
      
      // 使用 cli-highlight 进行高亮渲染，如果失败则回退到原生文本
      let highlighted = t.text;
      try {
        highlighted = highlight(t.text, { language: t.lang || 'plaintext', ignoreIllegals: true });
      } catch (e) {
        // fallback
      }
      
      const lines = highlighted.split('\n');
      // 去除尾部空行
      while (lines.length > 0 && lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, '').trim() === '') {
        lines.pop();
      }
      return (
        <Box key={key} flexDirection="column">
          <Text>
            <Text dimColor>{'╭─ '}</Text>
            <Text bold color="gray">{t.lang || 'code'}</Text>
          </Text>
          {lines.map((line, li) => (
            <Text key={li}>
              <Text dimColor>{'│  '}</Text>
              <Text>{line}</Text> {/* 注意：这里 line 包含了 ANSI 转义序列，Ink 的 Text 会将其原样透传给终端，终端会自动解析色彩 */}
            </Text>
          ))}
          <Text>
            <Text dimColor>{'╰─'}</Text>
            {cursor}
          </Text>
        </Box>
      );
    }

    // ── 引用 ──
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      const inner = t.tokens || [];
      return (
        <Box key={key} flexDirection="column">
          {inner.map((bt, bi) => {
            const isLast = bi === inner.length - 1;
            if (bt.type === 'paragraph') {
              return (
                <Box key={bi}>
                  <Text color="gray">{'▌ '}</Text>
                  <Text dimColor italic wrap="wrap">
                    {renderInline((bt as Tokens.Paragraph).tokens, `${key}.${bi}.`)}
                    {isLast && cursor}
                  </Text>
                </Box>
              );
            }
            // 嵌套块级元素
            return (
              <Box key={bi} flexDirection="row">
                <Text color="gray">{'▌ '}</Text>
                <Box flexDirection="column">
                  {renderBlock(bt, `${key}.${bi}`, termWidth, isLast ? cursor : undefined)}
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }

    // ── 列表 ──
    case 'list': {
      const t = token as Tokens.List;
      return (
        <Box key={key} flexDirection="column">
          {t.items.map((item, ii) => {
            const isLastItem = ii === t.items.length - 1;
            // 标记
            let marker: string;
            if (item.task) {
              marker = item.checked ? '☑ ' : '☐ ';
            } else if (t.ordered) {
              marker = `${(t.start ?? 1) + ii}. `;
            } else {
              marker = '• ';
            }

            return (
              <Box key={ii}>
                <Text>{'  '}{marker}</Text>
                <Box flexDirection="column" flexGrow={1}>
                  {item.tokens.map((it, iti) => {
                    const isLastToken = iti === item.tokens.length - 1;
                    const itemCursor = isLastItem && isLastToken ? cursor : undefined;

                    if (it.type === 'text') {
                      const txt = it as Tokens.Text;
                      if (txt.tokens && txt.tokens.length > 0) {
                        return (
                          <Text key={iti} wrap="wrap">
                            {renderInline(txt.tokens, `${key}.${ii}.${iti}.`)}
                            {itemCursor}
                          </Text>
                        );
                      }
                      return (
                        <Text key={iti} wrap="wrap">
                          {unescape(txt.text)}
                          {itemCursor}
                        </Text>
                      );
                    }
                    // 嵌套列表等块级元素
                    return renderBlock(it, `${key}.${ii}.${iti}`, termWidth, itemCursor);
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }

    // ── 分隔线 ──
    case 'hr':
      return (
        <Box key={key}>
          <Text dimColor>{'─'.repeat(Math.max(3, termWidth - 10))}</Text>
          {cursor}
        </Box>
      );

    // ── 表格 ──
    case 'table': {
      const t = token as Tokens.Table;
      const colCount = t.header.length;

      // 计算每列最大显示宽度
      const colWidths: number[] = t.header.map(h => displayWidth(unescape(h.text)));
      for (const row of t.rows) {
        for (let ci = 0; ci < colCount; ci++) {
          if (ci < row.length) {
            colWidths[ci] = Math.max(colWidths[ci], displayWidth(unescape(row[ci].text)));
          }
        }
      }

      /** 渲染单元格：居中对齐，两侧补空格 */
      const renderCell = (cell: Tokens.TableCell, ci: number, kp: string, bold?: boolean): React.ReactNode => {
        const textW = displayWidth(unescape(cell.text));
        const total = Math.max(0, colWidths[ci] - textW);
        const padL = Math.floor(total / 2);
        const padR = total - padL;
        return (
          <Text key={ci}>
            <Text dimColor>{'│'}</Text>
            {' '.repeat(padL + 1)}
            <Text bold={bold}>{renderInline(cell.tokens, kp)}</Text>
            {' '.repeat(padR + 1)}
          </Text>
        );
      };

      // 分隔行构造
      const hrLine = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
      const topLine = colWidths.map(w => '─'.repeat(w + 2)).join('┬');
      const botLine = colWidths.map(w => '─'.repeat(w + 2)).join('┴');

      return (
        <Box key={key} flexDirection="column">
          {/* 顶部边框 ┌──┬──┐ */}
          <Text dimColor wrap="truncate-end">{'┌'}{topLine}{'┐'}</Text>
          {/* 表头 │ xx │ yy │ */}
          <Text wrap="truncate-end">
            {t.header.map((cell, ci) => renderCell(cell, ci, `${key}.h${ci}.`, true))}
            <Text dimColor>{'│'}</Text>
          </Text>
          {/* 表头分隔 ├──┼──┤ */}
          <Text dimColor wrap="truncate-end">{'├'}{hrLine}{'┤'}</Text>
          {/* 数据行 */}
          {t.rows.map((row, ri) => (
            <Text key={ri} wrap="truncate-end">
              {row.map((cell, ci) => renderCell(cell, ci, `${key}.r${ri}.c${ci}.`))}
              <Text dimColor>{'│'}</Text>
            </Text>
          ))}
          {/* 底部边框 └──┴──┘ */}
          <Text dimColor wrap="truncate-end">{'└'}{botLine}{'┘'}</Text>
          {cursor}
        </Box>
      );
    }

    // ── HTML ──
    case 'html': {
      const t = token as Tokens.HTML;
      const text = t.text.trim();
      if (!text) return cursor ? <Text key={key}>{cursor}</Text> : null;
      return <Text key={key} dimColor>{text}{cursor}</Text>;
    }

    // ── 空行 ──
    case 'space':
      return cursor ? <Text key={key}>{cursor}</Text> : null;

    // ── 未知类型 ──
    default: {
      if (Array.isArray(token.tokens)) {
        return (
          <Box key={key}>
            <Text wrap="wrap">
              {renderInline(token.tokens, `${key}.`)}
              {cursor}
            </Text>
          </Box>
        );
      }
      if (typeof token.text === 'string') {
        return (
          <Text key={key}>
            {unescape(token.text)}
            {cursor}
          </Text>
        );
      }
      return cursor ? <Text key={key}>{cursor}</Text> : null;
    }
  }
}

// ── 主组件 ──────────────────────────────────────────────

interface MarkdownTextProps {
  /** Markdown 原始文本 */
  text: string;
  /** 是否在末尾显示流式光标 */
  showCursor?: boolean;
}

export function MarkdownText({ text, showCursor }: MarkdownTextProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  // 解析 token 并缓存
  const tokens = useMemo<Token[] | null>(() => {
    if (!text) return null;
    try {
      return marked.lexer(text) as Token[];
    } catch {
      return null;
    }
  }, [text]);

  const cursorNode = showCursor
    ? <Text backgroundColor="green">{' '}</Text>
    : undefined;

  // 空文本
  if (!text || !tokens || tokens.length === 0) {
    return cursorNode ?? null;
  }

  // 找到最后一个非 space token 的下标
  let lastIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].type !== 'space') {
      lastIdx = i;
      break;
    }
  }

  if (lastIdx < 0) {
    return cursorNode ?? null;
  }

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const isLast = i === lastIdx;
    const node = renderBlock(
      tokens[i],
      `b${i}`,
      termWidth,
      isLast ? cursorNode : undefined,
    );
    if (node != null) {
      nodes.push(node);
    }
  }

  if (nodes.length === 0) {
    return cursorNode ?? null;
  }

  return <Box flexDirection="column">{nodes}</Box>;
}
