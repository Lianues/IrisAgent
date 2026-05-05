/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { ToolInvocation } from 'irises-extension-sdk';
import type { ApprovalChoice } from '../app-types';
import { C } from '../theme';

function getPlanProgress(invocation: ToolInvocation): { plan?: string; planFilePath?: string } {
  const progress = invocation.progress as Record<string, unknown> | undefined;
  if (!progress || progress.kind !== 'plan_approval') return {};
  return {
    plan: typeof progress.plan === 'string' ? progress.plan : undefined,
    planFilePath: typeof progress.planFilePath === 'string' ? progress.planFilePath : undefined,
  };
}

interface PlanApprovalBarProps {
  invocation: ToolInvocation;
  remainingCount: number;
  choice: ApprovalChoice;
}

export function PlanApprovalBar({ invocation, remainingCount, choice }: PlanApprovalBarProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const { plan, planFilePath } = getPlanProgress(invocation);
  const borderColor = choice === 'approve' ? C.accent : C.error;
  const planLines = plan?.trim()
    ? plan.trim().split(/\r?\n/)
    : ['正在读取计划内容…'];
  // 底部审批面板不能在小终端里挤掉主区域：按终端高度自适应，最大 18 行。
  const maxVisiblePlanLines = Math.max(6, Math.min(18, Math.floor(terminalHeight * 0.55)));
  const needsScroll = planLines.length > maxVisiblePlanLines;

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingLeft={1}
      paddingRight={1}
      paddingY={0}
    >
      <text>
        <span fg={C.warn}><strong>? </strong></span>
        <span fg={C.text}>批准执行当前计划？</span>
        <span fg={C.dim}>  </span>
        <span fg={choice === 'approve' ? C.accent : C.textSec}>{choice === 'approve' ? '[(Y/Enter)批准]' : ' (Y/Enter)批准 '}</span>
        <span fg={C.dim}> </span>
        <span fg={choice === 'reject' ? C.error : C.textSec}>{choice === 'reject' ? '[(N)拒绝]' : ' (N)拒绝 '}</span>
        {remainingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${remainingCount - 1} 个)`}</span> : null}
        <span fg={C.dim}>  ←/→ 选择</span>
      </text>
      {planFilePath ? <text><span fg={C.dim}>计划文件：{planFilePath}</span></text> : null}
      <scrollbox
        marginTop={1}
        height={Math.min(planLines.length, maxVisiblePlanLines)}
        borderStyle="single"
        borderColor={C.border}
        verticalScrollbarOptions={{ visible: needsScroll }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {planLines.map((line, index) => (
          <text key={index}><span fg={index === 0 ? C.text : C.textSec}>{line || ' '}</span></text>
        ))}
      </scrollbox>
      {needsScroll ? <text fg={C.dim}>滚轮可滚动计划内容</text> : null}
    </box>
  );
}
