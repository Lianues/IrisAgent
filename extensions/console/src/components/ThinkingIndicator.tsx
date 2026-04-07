/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
import type { ThinkingEffortLevel } from '../app-types';

const BLOCK_COUNT = 4;

const FILL_MAP: Record<ThinkingEffortLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
};

const FILLED_CHAR = ICONS.thinkingFilled; // ￭ (Halfwidth) / = (ASCII)
const DIM_CHAR = ICONS.thinkingDim;       // ￮ (Halfwidth) / - (ASCII)

interface ThinkingIndicatorProps {
  level: ThinkingEffortLevel;
  /** 是否显示操作提示（首次进入时显示） */
  showHint?: boolean;
  /** 当前是否处于远程连接状态 */
  isRemote?: boolean;
}

export function ThinkingIndicator({ level, showHint, isRemote }: ThinkingIndicatorProps) {
  const filled = FILL_MAP[level];
  const isDisabled = level === 'none';

  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const isFilled = i < filled;
    blocks.push(
      <span key={i} fg={isFilled ? C.accent : C.dim}>
        {isFilled ? FILLED_CHAR : DIM_CHAR}
      </span>,
    );
  }

  return (
    <box flexDirection="row">
      <box flexGrow={1}>
        <text>
          {blocks}
          <span fg={isDisabled ? C.dim : C.accent}> {isDisabled ? 'thinking off' : level}</span>
        </text>
      </box>
      {isRemote ? (
        <box flexShrink={0}>
          <text fg={C.dim}>输入 /disconnect 断开远程连接</text>
        </box>
      ) : null}
      {showHint ? (
        <box flexShrink={0}>
          <text fg={C.dim}>{`shift+${ICONS.arrowLeft}/${ICONS.arrowRight} 调整思考强度`}</text>
        </box>
      ) : null}
    </box>
  );
}
