/** @jsxImportSource @opentui/react */

/**
 * 单条消息渲染
 */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { ToolInvocation } from '../../../types';
import { MarkdownText } from './MarkdownText';
import { GeneratingTimer } from './GeneratingTimer';
import { ToolCall } from './ToolCall';
import { C } from '../theme';

function getThoughtTailPreview(text: string, maxChars: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const latestLine = lines[lines.length - 1];
  if (latestLine.length <= maxChars) return latestLine;
  return `\u2026${latestLine.slice(-(maxChars - 1))}`;
}


function formatElapsedMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokenSpeed(tokenOut: number, durationMs: number): string {
  return `${(tokenOut / Math.max(durationMs / 1000, 0.001)).toFixed(1)} t/s`;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string; durationMs?: number }
  | { type: 'tool_use'; tools: ToolInvocation[] };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  isError?: boolean;
  parts: MessagePart[];
  tokenIn?: number;
  tokenOut?: number;
  durationMs?: number;
  streamOutputDurationMs?: number;
  modelName?: string;
}

interface MessageItemProps {
  msg: ChatMessage;
  liveTools?: ToolInvocation[];
  liveParts?: MessagePart[];
  isStreaming?: boolean;
  modelName?: string;
}

/**
 * 将 displayParts 中连续的 tool_use 合并为一组，
 * 其余类型保持原样，返回统一的渲染单元数组。
 */
type RenderGroup =
  | { kind: 'text'; part: MessagePart & { type: 'text' }; index: number }
  | { kind: 'thought'; part: MessagePart & { type: 'thought' }; index: number }
  | { kind: 'tools'; tools: ToolInvocation[]; startIndex: number };

function groupParts(parts: MessagePart[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === 'tool_use') {
      // 同一次 API 调用的连续 tool_use 合并为一组（跳过中间的空 text）
      const allTools: ToolInvocation[] = [];
      const start = i;
      while (i < parts.length) {
        const p = parts[i];
        if (p.type === 'tool_use') { allTools.push(...p.tools); }
        else if (p.type === 'text' && !p.text.trim()) { /* 跳过空文本 */ }
        else { break; }
        i++;
      }
      groups.push({ kind: 'tools', tools: allTools, startIndex: start });
    } else if (part.type === 'text' && part.text.trim()) {
      groups.push({ kind: 'text', part: part as MessagePart & { type: 'text' }, index: i });
      i++;
    } else if (part.type === 'thought') {
      groups.push({ kind: 'thought', part: part as MessagePart & { type: 'thought' }, index: i });
      i++;
    } else {
      i++;
    }
  }
  return groups;
}

export const MessageItem = React.memo(function MessageItem(
  { msg, liveTools, liveParts, isStreaming, modelName }: MessageItemProps
) {
  const { width: termWidth } = useTerminalDimensions();
  const isUser = msg.role === 'user';
  const labelName = isUser ? 'you' : (msg.modelName || modelName || 'iris').toLowerCase();
  const labelColor = isUser ? C.roleUser : (msg.isError ? C.error : C.roleAssistant);
  const headerText = `\u00b7 ${labelName} `;

  const displayParts: MessagePart[] = [...msg.parts];
  if (liveParts && liveParts.length > 0) displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0) displayParts.push({ type: 'tool_use', tools: liveTools });

  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);
  const groups = groupParts(displayParts);

  return (
    <box flexDirection="column" width="100%">
      {/* 楼层头部 */}
      <box marginBottom={1}>
        <text>
          <span fg={labelColor}><strong>{headerText}</strong></span>
          <span fg={labelColor}>{'\u2500'.repeat(separatorLen)}</span>
        </text>
      </box>

      <box flexDirection="column" width="100%">
        {groups.map((group, gi) => {
          if (group.kind === 'text' && group.part.text.length > 0) {
            const isLastGroup = gi === groups.length - 1;
            return (
              <box key={group.index} marginTop={gi > 0 ? 1 : 0}>
                {isUser ? (
                  <text fg={C.text}>{group.part.text}</text>
                ) : msg.isError ? (
                  <text fg={C.error}>{group.part.text}</text>
                ) : (
                  <MarkdownText text={group.part.text} showCursor={isLastGroup && isStreaming} />
                )}
              </box>
            );
          }

          if (group.kind === 'thought') {
            const previewText = getThoughtTailPreview(group.part.text, Math.max(24, termWidth - 20));
            const isLastGroup = gi === groups.length - 1;
            const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
            const isAfterTools = prevGroup?.kind === 'tools';
            const prefix = group.part.durationMs != null ? `thinking   ${formatElapsedMs(group.part.durationMs)}` : 'thinking';
            return (
              <box key={group.index} marginTop={(isAfterTools) ? 0 : (gi > 0 ? 1 : 0)} flexDirection="column"
                   backgroundColor={C.thinkingBg} paddingLeft={1}>
                <text fg={C.primaryLight}><em>{'\u00b7 ' + prefix}</em></text>
                <box flexDirection="column">
                  <text fg={C.dim}>
                    <em>
                      {'    '}{previewText ? previewText : '...'}
                      {isLastGroup && isStreaming ? <span bg={C.accent}> </span> : null}
                    </em>
                  </text>
                </box>
              </box>
            );
          }

          if (group.kind === 'tools') {
            const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
            const isConsecutiveTools = prevGroup?.kind === 'tools';
            const isAfterThought = prevGroup?.kind === 'thought';
            return (
              <box key={`tools-${group.startIndex}`} flexDirection="column" width="100%" marginTop={(isConsecutiveTools || isAfterThought) ? 0 : (gi > 0 ? 1 : 0)}>
                <box flexDirection="column" backgroundColor={C.toolPendingBg} paddingLeft={1}>
                  <text fg={C.accent}><strong>{'\u00b7 tools'}</strong></text>
                  {group.tools.map(inv => <ToolCall key={inv.id} invocation={inv} />)}
                </box>
              </box>
            );
          }

          return null;
        })}

        {/* token / 耗时信息 */}
        {!isUser && !isStreaming && (msg.tokenIn != null || msg.durationMs != null) && (
          <box marginTop={hasAnyContent ? 1 : 0}>
            <text fg={C.dim}>
              {msg.durationMs != null ? `${(msg.durationMs / 1000).toFixed(1)}s` : ''}
              {msg.tokenIn != null ? `  \u2191${msg.tokenIn.toLocaleString()}` : ''}
              {msg.tokenOut != null ? `  \u2193${msg.tokenOut.toLocaleString()}` : ''}
              {msg.tokenOut != null && msg.streamOutputDurationMs != null
                ? `   ${formatTokenSpeed(msg.tokenOut, msg.streamOutputDurationMs)}`
                : ''}
            </text>
          </box>
        )}

        {!hasAnyContent && isStreaming && (
          <box><GeneratingTimer isGenerating={true} /></box>
        )}
        {!hasAnyContent && !isStreaming && (
          <text>{' '}</text>
        )}
      </box>
    </box>
  );
});
