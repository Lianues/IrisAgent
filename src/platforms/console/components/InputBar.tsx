/**
 * 底部输入栏
 *
 * 自行处理按键输入，支持多行编辑（Ctrl+J 换行，Enter 提交）。
 * 输入 / 时在下方显示可用指令列表，输入更多字符时按前缀过滤。
 * 支持 Tab 自动补全和切换，支持上下箭头切换选中指令。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import { COMMANDS, type Command, getCommandInput, isExactCommandValue } from '../input-commands';
import {
  findIndexByCellOffset,
  getCellOffsetForIndex,
  getLineLength,
  getTextWidth,
  insertTextAtIndex,
  removeGraphemeBeforeIndex,
  splitLineAtIndex,
  splitVisualChunks,
} from '../text-layout';

interface InputBarProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

const PROMPT_PREFIX = '❯ ';
const CONTINUATION_PREFIX = '  ';

/** 前缀宽度（"❯ " 或 "  "） */
const PREFIX_WIDTH = getTextWidth(PROMPT_PREFIX);

export function InputBar({ disabled, onSubmit }: InputBarProps) {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0); // 当前逻辑行中的 grapheme 索引
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdout } = useStdout();

  // 单行值（用于指令匹配）
  const flatValue = lines.join('\n');
  // 指令匹配只看第一行
  const firstLine = lines[0] ?? '';
  const isMultiline = lines.length > 1;

  const exactMatchIndex = useMemo(() => {
    if (isMultiline) return -1;
    return COMMANDS.findIndex((cmd) => isExactCommandValue(firstLine, cmd));
  }, [firstLine, isMultiline]);

  const commandQuery = useMemo(() => {
    if (disabled || isMultiline) return '';
    if (!firstLine.startsWith('/')) return '';
    if (/\s/.test(firstLine) && exactMatchIndex < 0) return '';
    return firstLine;
  }, [disabled, firstLine, exactMatchIndex, isMultiline]);

  const showCommands = commandQuery.length > 0;

  const filtered = useMemo(() => {
    if (!showCommands) return [];
    if (exactMatchIndex >= 0) return COMMANDS;
    return COMMANDS.filter((cmd) => cmd.name.startsWith(commandQuery.trim()));
  }, [showCommands, exactMatchIndex, commandQuery]);

  useEffect(() => {
    if (!showCommands || filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (exactMatchIndex >= 0) {
      setSelectedIndex(exactMatchIndex);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, filtered.length - 1));
  }, [showCommands, filtered.length, exactMatchIndex]);

  const insertNewLine = () => {
    setLines((prev) => {
      const copy = [...prev];
      const line = copy[cursorLine] ?? '';
      const { before, after } = splitLineAtIndex(line, cursorCol);
      copy.splice(cursorLine, 1, before, after);
      return copy;
    });
    setCursorLine((prev) => prev + 1);
    setCursorCol(0);
  };

  const doSubmit = () => {
    if (disabled) return;
    const text = flatValue.trim();
    if (!text) return;
    onSubmit(text);
    setLines(['']);
    setCursorLine(0);
    setCursorCol(0);
    setSelectedIndex(0);
  };

  const setValueFromCommand = (text: string) => {
    setLines([text]);
    setCursorLine(0);
    setCursorCol(getLineLength(text));
  };

  const applySelection = (index: number) => {
    if (filtered.length === 0) return;
    const normalizedIndex = ((index % filtered.length) + filtered.length) % filtered.length;
    const cmd = filtered[normalizedIndex];
    setSelectedIndex(normalizedIndex);
    setValueFromCommand(getCommandInput(cmd));
  };

  useInput((input, key) => {
    if (disabled) return;

    // ---- 指令面板导航（仅单行且显示指令列表时） ----
    if (showCommands && filtered.length > 0) {
      if (key.upArrow) {
        applySelection(selectedIndex - 1);
        return;
      }
      if (key.downArrow) {
        applySelection(selectedIndex + 1);
        return;
      }
      if (key.tab || input === '\t') {
        const current = filtered[selectedIndex];
        if (current) {
          if (isExactCommandValue(firstLine, current)) {
            applySelection(selectedIndex + 1);
          } else {
            applySelection(selectedIndex);
          }
        }
        return;
      }
    }

    // ---- Ctrl+C ----
    if (key.ctrl && input === 'c') return;

    // ---- Line Feed (\n): 换行（常见于 Ctrl+J；部分终端会把它当作独立键发送） ----
    // Ink 在很多终端里无法区分 Shift+Enter，但通常可以收到 Ctrl+J（\n）。
    if (input === '\n') {
      insertNewLine();
      return;
    }

    // ---- Enter：提交 ----
    if (key.return) {
      doSubmit();
      return;
    }

    // ---- Tab（非指令模式忽略） ----
    if (key.tab || input === '\t') return;

    // ---- 方向键 ----
    if (key.upArrow) {
      if (cursorLine > 0) {
        const targetCell = getCellOffsetForIndex(lines[cursorLine] ?? '', cursorCol);
        const prevLine = lines[cursorLine - 1] ?? '';
        setCursorLine((prev) => prev - 1);
        setCursorCol(findIndexByCellOffset(prevLine, targetCell));
      }
      return;
    }
    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        const targetCell = getCellOffsetForIndex(lines[cursorLine] ?? '', cursorCol);
        const nextLine = lines[cursorLine + 1] ?? '';
        setCursorLine((prev) => prev + 1);
        setCursorCol(findIndexByCellOffset(nextLine, targetCell));
      }
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol((prev) => prev - 1);
      } else if (cursorLine > 0) {
        const prevLineLen = getLineLength(lines[cursorLine - 1] ?? '');
        setCursorLine((prev) => prev - 1);
        setCursorCol(prevLineLen);
      }
      return;
    }
    if (key.rightArrow) {
      const lineLen = getLineLength(lines[cursorLine] ?? '');
      if (cursorCol < lineLen) {
        setCursorCol((prev) => prev + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine((prev) => prev + 1);
        setCursorCol(0);
      }
      return;
    }

    // ---- Backspace ----
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        setLines((prev) => {
          const copy = [...prev];
          const line = copy[cursorLine] ?? '';
          const { nextText } = removeGraphemeBeforeIndex(line, cursorCol);
          copy[cursorLine] = nextText;
          return copy;
        });
        setCursorCol((prev) => prev - 1);
      } else if (cursorLine > 0) {
        // 合并到上一行
        const prevLineLen = getLineLength(lines[cursorLine - 1] ?? '');
        setLines((prev) => {
          const copy = [...prev];
          copy[cursorLine - 1] = (copy[cursorLine - 1] ?? '') + (copy[cursorLine] ?? '');
          copy.splice(cursorLine, 1);
          return copy;
        });
        setCursorLine((prev) => prev - 1);
        setCursorCol(prevLineLen);
      }
      return;
    }

    // ---- 普通字符输入 ----
    if (input) {
      const inputLength = getLineLength(input);

      setLines((prev) => {
        const copy = [...prev];
        const line = copy[cursorLine] ?? '';
        copy[cursorLine] = insertTextAtIndex(line, cursorCol, input);
        return copy;
      });
      setCursorCol((prev) => prev + inputLength);

      // 更新指令选中
      if (cursorLine === 0) {
        const nextFirstLine = insertTextAtIndex(lines[0] ?? '', cursorCol, input);
        if (nextFirstLine.startsWith('/') && !isMultiline) {
          const nextExactIndex = COMMANDS.findIndex((cmd) => isExactCommandValue(nextFirstLine, cmd));
          if (nextExactIndex >= 0) {
            setSelectedIndex(nextExactIndex);
          } else {
            const nextFiltered = COMMANDS.filter((cmd) => cmd.name.startsWith(nextFirstLine.trim()));
            if (nextFiltered.length > 0) {
              setSelectedIndex(0);
            }
          }
        }
      }
    }
  });

  // ---- 渲染 ----

  const termWidth = stdout?.columns ?? 80;
  const contentWidth = Math.max(1, termWidth - PREFIX_WIDTH);

  /** 将一行文本按终端宽度拆成视觉行，并标记光标位置 */
  function renderLine(text: string, lineIndex: number, isFirstLine: boolean): React.ReactNode[] {
    const isCursorLine = lineIndex === cursorLine;
    const rows: React.ReactNode[] = [];
    const chunks = splitVisualChunks(text, contentWidth);
    const lineLength = getLineLength(text);

    // 空行也要渲染一行
    if (text.length === 0) {
      const prefix = isFirstLine
        ? <Text color={disabled ? 'gray' : 'cyan'} bold>{PROMPT_PREFIX}</Text>
        : <Text dimColor>{CONTINUATION_PREFIX}</Text>;
      const cursor = isCursorLine && !disabled ? chalk.inverse(' ') : '';
      rows.push(
        <Box key={`${lineIndex}-0`} flexDirection="row">
          {prefix}
          <Text>{cursor}</Text>
        </Box>,
      );
      return rows;
    }

    chunks.forEach((chunk, rowIdx) => {
      const prefix = rowIdx === 0
        ? (isFirstLine
          ? <Text color={disabled ? 'gray' : 'cyan'} bold>{PROMPT_PREFIX}</Text>
          : <Text dimColor>{CONTINUATION_PREFIX}</Text>)
        : <Text dimColor>{CONTINUATION_PREFIX}</Text>;

      let rendered = chunk.graphemes.join('');

      // 光标在本视觉行内部：反色显示“光标所在的字符”（与 ink-text-input 一致）
      if (
        isCursorLine
        && !disabled
        && cursorCol >= chunk.startIndex
        && cursorCol < chunk.endIndex
      ) {
        const relIndex = cursorCol - chunk.startIndex;
        const before = chunk.graphemes.slice(0, relIndex).join('');
        const cursorGrapheme = chunk.graphemes[relIndex] ?? ' ';
        const after = chunk.graphemes.slice(relIndex + 1).join('');
        rendered = before + chalk.inverse(cursorGrapheme) + after;
      }

      // 光标在文本末尾：显示“反色空格”作为光标（与 ink-text-input 一致）
      const isEndOfTextCursor = isCursorLine && !disabled
        && cursorCol === lineLength
        && chunk.endIndex === lineLength;

      const needsCursorSpace = isEndOfTextCursor;

      // 特殊情况：文本刚好填满一行宽度时，如果在本行末尾追加“反色空格”，会多占 1 列并触发额外换行。
      // 这里改为反色显示本行最后一个 grapheme，避免显示抖动。
      if (needsCursorSpace && chunk.width >= contentWidth && chunk.graphemes.length > 0) {
        const lastGrapheme = chunk.graphemes[chunk.graphemes.length - 1];
        rendered = chunk.graphemes.slice(0, -1).join('') + chalk.inverse(lastGrapheme);
      }

      rows.push(
        <Box key={`${lineIndex}-${rowIdx}`} flexDirection="row">
          {prefix}
          <Text>{needsCursorSpace && chunk.width < contentWidth ? rendered + chalk.inverse(' ') : rendered}</Text>
        </Box>,
      );
    });

    return rows;
  }

  const maxLen = filtered.length > 0
    ? Math.max(...filtered.map((cmd) => cmd.name.length))
    : 0;

  return (
    <Box flexDirection="column">
      {/* 输入区域 */}
      {lines.map((line, i) => renderLine(line, i, i === 0))}

      {/* 多行提示 */}
      {lines.length === 1 && !disabled && (
        <Text dimColor>{'  Ctrl+J 换行'}</Text>
      )}

      {/* 指令列表 */}
      {filtered.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {filtered.map((cmd: Command, index) => {
            const padded = cmd.name.padEnd(maxLen);
            const isSelected = index === selectedIndex;
            return (
              <Text key={cmd.name}>
                <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '>' : ' '}</Text>
                <Text> </Text>
                <Text color={isSelected ? 'cyan' : 'white'}>{padded}</Text>
                <Text dimColor>  {cmd.description}</Text>
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
