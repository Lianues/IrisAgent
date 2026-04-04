/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import type { ThinkingEffortLevel } from '../app-types';

const BLOCK_COUNT = 4;

const FILL_MAP: Record<ThinkingEffortLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
};

const FILLED_CHAR = '\u25A3'; // ▣ (有内框的实心方块，比 ■ 稍大)
const DIM_CHAR = '\u25A2';    // ▢ (圆角空心方块，比 □ 稍大)

interface ThinkingIndicatorProps {
  level: ThinkingEffortLevel;
  /** 是否显示操作提示（首次进入时显示） */
  showHint?: boolean;
}

export function ThinkingIndicator({ level, showHint }: ThinkingIndicatorProps) {
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
      {showHint ? (
        <box>
          <text fg={C.dim}>{`shift+\u2190/\u2192 调整思考强度`}</text>
        </box>
      ) : null}
    </box>
  );
}
