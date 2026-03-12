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

/** 指令定义 */
export interface Command {
  name: string;
  description: string;
}

/** 内置指令列表 */
export const COMMANDS: Command[] = [
  { name: '/new',      description: '新建对话' },
  { name: '/load',     description: '加载历史对话' },
  { name: '/model',    description: '查看或切换当前模型' },
  { name: '/settings', description: '打开设置中心（LLM / System / MCP）' },
  { name: '/mcp',      description: '直接打开 MCP 管理区' },
  { name: '/sh',       description: '执行命令（如 cd、dir、git 等）' },
  { name: '/exit',     description: '退出应用' },
];

interface InputBarProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

function getCommandInput(cmd: Command): string {
  return cmd.name === '/sh' || cmd.name === '/model' ? `${cmd.name} ` : cmd.name;
}

function isExactCommandValue(value: string, cmd: Command): boolean {
  return value === cmd.name || value === getCommandInput(cmd);
}

/** 前缀宽度（"❯ " 或 "  "） */
const PREFIX_WIDTH = 2;

export function InputBar({ disabled, onSubmit }: InputBarProps) {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdout } = useStdout();

  // 单行值（用于指令匹配）
  const flatValue = lines.join('\n');
  // 指令匹配只看第一行
  const firstLine = lines[0] ?? '';
  const isMultiline = lines.length > 1;

  const exactMatchIndex = useMemo(() => {
    if (isMultiline) return -1;
    return COMMANDS.findIndex(cmd => isExactCommandValue(firstLine, cmd));
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
    return COMMANDS.filter(cmd => cmd.name.startsWith(commandQuery.trim()));
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
    setSelectedIndex(prev => Math.min(prev, filtered.length - 1));
  }, [showCommands, filtered.length, exactMatchIndex]);

  const insertNewLine = () => {
    setLines(prev => {
      const copy = [...prev];
      const line = copy[cursorLine] ?? '';
      const before = line.slice(0, cursorCol);
      const after = line.slice(cursorCol);
      copy.splice(cursorLine, 1, before, after);
      return copy;
    });
    setCursorLine(prev => prev + 1);
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
    setCursorCol(text.length);
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
        const prevLineLen = (lines[cursorLine - 1] ?? '').length;
        setCursorLine(prev => prev - 1);
        setCursorCol(Math.min(cursorCol, prevLineLen));
      }
      return;
    }
    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        const nextLineLen = (lines[cursorLine + 1] ?? '').length;
        setCursorLine(prev => prev + 1);
        setCursorCol(Math.min(cursorCol, nextLineLen));
      }
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(prev => prev - 1);
      } else if (cursorLine > 0) {
        const prevLineLen = (lines[cursorLine - 1] ?? '').length;
        setCursorLine(prev => prev - 1);
        setCursorCol(prevLineLen);
      }
      return;
    }
    if (key.rightArrow) {
      const lineLen = (lines[cursorLine] ?? '').length;
      if (cursorCol < lineLen) {
        setCursorCol(prev => prev + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine(prev => prev + 1);
        setCursorCol(0);
      }
      return;
    }

    // ---- Backspace ----
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        setLines(prev => {
          const copy = [...prev];
          const line = copy[cursorLine] ?? '';
          copy[cursorLine] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
          return copy;
        });
        setCursorCol(prev => prev - 1);
      } else if (cursorLine > 0) {
        // 合并到上一行
        const prevLineLen = (lines[cursorLine - 1] ?? '').length;
        setLines(prev => {
          const copy = [...prev];
          copy[cursorLine - 1] = (copy[cursorLine - 1] ?? '') + (copy[cursorLine] ?? '');
          copy.splice(cursorLine, 1);
          return copy;
        });
        setCursorLine(prev => prev - 1);
        setCursorCol(prevLineLen);
      }
      return;
    }

    // ---- 普通字符输入 ----
    if (input) {
      setLines(prev => {
        const copy = [...prev];
        const line = copy[cursorLine] ?? '';
        copy[cursorLine] = line.slice(0, cursorCol) + input + line.slice(cursorCol);
        return copy;
      });
      setCursorCol(prev => prev + input.length);

      // 更新指令选中
      if (cursorLine === 0) {
        const nextFirstLine = (lines[0] ?? '').slice(0, cursorCol) + input + (lines[0] ?? '').slice(cursorCol);
        if (nextFirstLine.startsWith('/') && !isMultiline) {
          const nextExactIndex = COMMANDS.findIndex(cmd => isExactCommandValue(nextFirstLine, cmd));
          if (nextExactIndex >= 0) {
            setSelectedIndex(nextExactIndex);
          } else {
            const nextFiltered = COMMANDS.filter(cmd => cmd.name.startsWith(nextFirstLine.trim()));
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

    // 空行也要渲染一行
    if (text.length === 0) {
      const prefix = isFirstLine
        ? <Text color={disabled ? 'gray' : 'cyan'} bold>{'\u276F'} </Text>
        : <Text dimColor>{'  '}</Text>;
      const cursor = isCursorLine && !disabled ? chalk.inverse(' ') : '';
      rows.push(
        <Box key={`${lineIndex}-0`} flexDirection="row">
          {prefix}
          <Text>{cursor}</Text>
        </Box>,
      );
      return rows;
    }

    // 按 contentWidth 拆分视觉行
    let offset = 0;
    let rowIdx = 0;
    while (offset < text.length || rowIdx === 0) {
      const chunk = text.slice(offset, offset + contentWidth);
      const chunkStart = offset;
      const chunkEnd = offset + chunk.length;
      offset = chunkEnd;

      const prefix = rowIdx === 0
        ? (isFirstLine
          ? <Text color={disabled ? 'gray' : 'cyan'} bold>{'\u276F'} </Text>
          : <Text dimColor>{'  '}</Text>)
        : <Text dimColor>{'  '}</Text>;

      let rendered: string;
      rendered = chunk;

      // 光标在本视觉行内部：反色显示“光标所在的字符”（与 ink-text-input 一致）
      if (
        isCursorLine
        && !disabled
        && cursorCol >= chunkStart
        && cursorCol < chunkEnd
      ) {
        const relPos = cursorCol - chunkStart;
        const before = chunk.slice(0, relPos);
        const cursorChar = chunk[relPos];
        const after = chunk.slice(relPos + 1);
        rendered = before + chalk.inverse(cursorChar) + after;
      }

      // 光标在文本末尾：显示“反色空格”作为光标（与 ink-text-input 一致）
      const isEndOfTextCursor = isCursorLine && !disabled
        && cursorCol === text.length
        && chunkEnd === text.length;

      const needsCursorSpace = isEndOfTextCursor;

      // 特殊情况：文本刚好填满一行宽度时，如果在本行末尾追加“反色空格”，会多占 1 列并触发额外换行。
      // 这里改为反色显示本行最后一个字符，避免显示抖动。
      if (needsCursorSpace && chunk.length >= contentWidth) {
        const lastChar = chunk[chunk.length - 1];
        rendered = chunk.slice(0, -1) + chalk.inverse(lastChar);
      }

      rows.push(
        <Box key={`${lineIndex}-${rowIdx}`} flexDirection="row">
          {prefix}
          <Text>{needsCursorSpace && chunk.length < contentWidth ? rendered + chalk.inverse(' ') : rendered}</Text>
        </Box>,
      );
      rowIdx++;

      if (chunk.length === 0) break;
    }

    return rows;
  }

  const maxLen = filtered.length > 0
    ? Math.max(...filtered.map(cmd => cmd.name.length))
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
          {filtered.map((cmd, index) => {
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
