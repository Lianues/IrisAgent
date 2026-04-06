/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

/** 最多显示的行数（超出可滚动） */
const MAX_VISIBLE_LINES = 3;

interface InitWarningsProps {
  warnings: string[];
  /** 自定义颜色（默认 C.warn 黄色） */
  color?: string;
  /** 自定义图标（默认 ⚠） */
  icon?: string;
}

/**
 * 初始化警告提示。
 *
 * 在首屏（LogoScreen 下方）显示初始化过程中收集的警告信息。
 * 最多显示 3 行，超出可滚动。
 * 用户发送第一条消息后，首屏消失，警告随之消失。
 */
export function InitWarnings({ warnings, color, icon }: InitWarningsProps) {
  if (warnings.length === 0) return null;
  const fg = color ?? C.warn;
  const prefix = icon ?? '⚠';
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} maxHeight={MAX_VISIBLE_LINES + 1}>
      {warnings.map((msg, i) => (
        <box key={i}>
          <text>
            <span fg={fg}>{prefix} </span>
            <span fg={fg}>{msg}</span>
          </text>
        </box>
      ))}
    </box>
  );
}
