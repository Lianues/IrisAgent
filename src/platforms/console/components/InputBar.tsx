/**
 * 底部输入栏
 *
 * 输入 / 时在下方显示可用指令列表，输入更多字符时按前缀过滤。
 */

import React, {useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

/** 指令定义 */
export interface Command {
  name: string;
  description: string;
}

/** 内置指令列表 */
export const COMMANDS: Command[] = [
  { name: '/new',  description: '新建对话' },
  { name: '/load', description: '加载历史对话' },
  { name: '/sh',   description: '执行命令（如 cd、dir、git 等）' },
  { name: '/exit', description: '退出应用' },
];

interface InputBarProps {
  disabled:boolean;
  onSubmit: (text: string) => void;
}

export function InputBar({ disabled, onSubmit }: InputBarProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  // 以 / 开头时过滤匹配的指令
  const showCommands = value.startsWith('/') && !disabled;
  const filtered = showCommands
    ? COMMANDS.filter(cmd => cmd.name.startsWith(value))
 : [];

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignSelf="flex-start">
        <Text color={disabled ? 'gray' : 'cyan'} bold>{"\u276F"} </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder=""
        />
      </Box>
      {filtered.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {filtered.map(cmd => {
            const maxLen = Math.max(...filtered.map(c => c.name.length));
            const padded = cmd.name.padEnd(maxLen);
            return (
            <Text key={cmd.name}>
              <Text color="cyan">{padded}</Text>
              <Text dimColor>  {cmd.description}</Text>
            </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
