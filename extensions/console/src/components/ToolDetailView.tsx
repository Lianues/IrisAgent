/** @jsxImportSource @opentui/react */

/**
 * 工具执行细节页面
 *
 * 全屏视图，展示单个工具执行的完整过程：
 * - 状态时间线（创建 → 执行 → 完成）
 * - 实时输出流
 * - 子工具列表（可点击嵌套进入）
 * - 执行结果
 *
 * 支持嵌套：子代理内部的工具可递归展示，通过导航栈（breadcrumb）管理层级。
 */

import React, { useState, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ToolInvocation, ToolOutputEntry, ToolStatus } from '@irises/extension-sdk';
import type { ToolDetailData, ToolDetailBreadcrumb } from '../app-types';
import { getToolRenderer, getToolDetailRenderer } from '../tool-renderers';
import { Spinner } from './Spinner';
import { C } from '../theme';

interface ToolDetailViewProps {
  data: ToolDetailData;
  breadcrumb: ToolDetailBreadcrumb[];
  onNavigateChild: (toolId: string) => void;
  onClose: () => void;
  onAbort?: (toolId: string) => void;
}

const TERMINAL_STATUSES = new Set<ToolStatus>(['success', 'warning', 'error']);

const STATUS_ICONS: Record<string, string> = {
  streaming: '📡',
  queued: '⏳',
  awaiting_approval: '🔐',
  executing: '🔧',
  awaiting_apply: '📋',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

const STATUS_LABELS: Record<string, string> = {
  streaming: '输出中',
  queued: '等待中',
  awaiting_approval: '等待审批',
  executing: '执行中',
  awaiting_apply: '等待应用',
  success: '成功',
  warning: '警告',
  error: '失败',
};

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  stdout: 'OUT',
  stderr: 'ERR',
  log: 'LOG',
  chat: 'CHAT',
  data: 'DATA',
};

const OUTPUT_TYPE_COLORS: Record<string, string> = {
  stdout: '#888',
  stderr: '#ff6b6b',
  log: '#888',
  chat: '#7ec8e3',
  data: '#b8bb26',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatDuration(startMs: number, endMs: number): string {
  const diff = (endMs - startMs) / 1000;
  return diff >= 0 ? `${diff.toFixed(1)}s` : '';
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(无参数)';
  const parts = entries.slice(0, 4).map(([key, val]) => {
    const v = typeof val === 'string'
      ? (val.length > 40 ? `"${val.slice(0, 40)}…"` : `"${val}"`)
      : JSON.stringify(val);
    const vStr = typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '…' : v;
    return `${key}=${vStr}`;
  });
  if (entries.length > 4) parts.push(`+${entries.length - 4} more`);
  return parts.join(', ');
}

export function ToolDetailView({ data, breadcrumb, onNavigateChild, onClose, onAbort }: ToolDetailViewProps) {
  const { invocation, output, children } = data;
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);

  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === 'executing';
  const icon = STATUS_ICONS[status] || '⏳';
  const label = STATUS_LABELS[status] || status;
  const duration = formatDuration(createdAt, updatedAt);

  // 自定义详情渲染器（工具注册的）
  const DetailRenderer = getToolDetailRenderer(toolName);
  // 结果渲染器（复用现有）
  const ResultRenderer = isFinal && result != null ? getToolRenderer(toolName) : null;

  // 键盘处理
  const handleKeyboard = useCallback((key: { name: string; ctrl?: boolean }) => {
    if (key.name === 'escape' || key.name === 'q') {
      onClose();
    } else if (key.name === 'a' && onAbort && !isFinal) {
      onAbort(invocation.id);
    } else if (children.length > 0) {
      if (key.name === 'up' || key.name === 'k') {
        setSelectedChildIdx(prev => Math.max(0, prev - 1));
      } else if (key.name === 'down' || key.name === 'j') {
        setSelectedChildIdx(prev => Math.min(children.length - 1, prev + 1));
      } else if (key.name === 'return') {
        const child = children[selectedChildIdx];
        if (child) onNavigateChild(child.id);
      }
    }
  }, [onClose, onAbort, isFinal, invocation.id, children, selectedChildIdx, onNavigateChild]);

  useKeyboard(handleKeyboard);

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* ── 面包屑导航 ── */}
      <box marginBottom={0}>
        <text>
          <span fg={C.dim}>{'← [Esc] '}</span>
          {breadcrumb.map((b, i) => (
            <span key={b.toolId}>
              <span fg={C.dim}>{b.toolName}</span>
              <span fg={C.dim}>{' > '}</span>
            </span>
          ))}
          <span fg={C.accent}><strong>{toolName}</strong></span>
        </text>
      </box>

      {/* ── 标题栏 ── */}
      <box marginBottom={0}>
        <text>
          <span fg={C.accent}><strong> {toolName} </strong></span>
          <span fg={isFinal ? (status === 'error' ? C.error : C.accent) : C.dim}>{icon} {label}</span>
          {duration ? <span fg={C.dim}> {duration}</span> : null}
          {isExecuting ? <span fg={C.dim}>{' '}</span> : null}
        </text>
        {isExecuting && <Spinner />}
      </box>

      {/* ── 参数 ── */}
      <box marginBottom={0}>
        <text>
          <span fg={C.dim}>  args: {formatArgs(args)}</span>
        </text>
      </box>

      <box marginTop={0} marginBottom={0}>
        <text><span fg={C.dim}>{'─'.repeat(60)}</span></text>
      </box>

      {/* ── 自定义详情渲染器 或 默认布局 ── */}
      {DetailRenderer ? (
        <box flexDirection="column" flexGrow={1}>
          {DetailRenderer({ invocation, output, children, onNavigateChild }) as React.ReactNode}
        </box>
      ) : (
        <box flexDirection="column" flexGrow={1}>
          {/* ── 输出流 ── */}
          {output.length > 0 && (
            <box flexDirection="column" marginBottom={0}>
              <text><span fg={C.dim}><strong>  输出</strong></span></text>
              <scrollbox height={Math.min(output.length + 1, 12)} flexShrink={0}>
                {output.map((entry, i) => {
                  const typeLabel = OUTPUT_TYPE_LABELS[entry.type] || entry.type;
                  const typeFg = OUTPUT_TYPE_COLORS[entry.type] || C.dim;
                  const time = formatTimestamp(entry.timestamp);
                  const content = entry.content.length > 120
                    ? entry.content.slice(0, 120) + '…'
                    : entry.content;
                  return (
                    <text key={i}>
                      <span fg={C.dim}>  {time} </span>
                      <span fg={typeFg}>[{typeLabel}]</span>
                      <span> {content.replace(/\n/g, ' ')}</span>
                    </text>
                  );
                })}
              </scrollbox>
            </box>
          )}

          {/* ── 子工具 ── */}
          {children.length > 0 && (
            <box flexDirection="column" marginBottom={0}>
              <text><span fg={C.dim}><strong>  子工具 ({children.length})</strong></span></text>
              {children.map((child, i) => {
                const isSelected = i === selectedChildIdx;
                const childIcon = STATUS_ICONS[child.status] || '⏳';
                const childDuration = formatDuration(child.createdAt, child.updatedAt);
                const depthPrefix = (child.depth ?? 0) > 0 ? '  '.repeat(child.depth!) : '';
                return (
                  <text key={child.id}>
                    <span fg={isSelected ? C.accent : C.dim}>{isSelected ? ' ▸ ' : '   '}</span>
                    <span>{depthPrefix}</span>
                    <span bg={child.status === 'error' ? C.error : C.accent} fg={C.cursorFg}> {child.toolName} </span>
                    <span fg={C.dim}> {childIcon}</span>
                    {childDuration ? <span fg={C.dim}> {childDuration}</span> : null}
                    {child.status === 'executing' ? <span fg={C.dim}>{' '}执行中…</span> : null}
                  </text>
                );
              })}
            </box>
          )}

          {/* ── 执行结果 ── */}
          {isFinal && (
            <box flexDirection="column" marginTop={0}>
              <text><span fg={C.dim}><strong>  结果</strong></span></text>
              {status === 'error' && error && (
                <text fg={C.error}>  {error}</text>
              )}
              {ResultRenderer && result != null && (
                <box paddingLeft={2}>
                  {ResultRenderer({ toolName, args, result }) as React.ReactNode}
                </box>
              )}
              {status === 'success' && !ResultRenderer && result != null && (
                <text fg={C.dim}>  <em>{JSON.stringify(result).slice(0, 200)}</em></text>
              )}
            </box>
          )}
        </box>
      )}

      {/* ── 底部快捷键提示 ── */}
      <box marginTop={0}>
        <text><span fg={C.dim}>{'─'.repeat(60)}</span></text>
      </box>
      <box>
        <text>
          <span fg={C.dim}> [Esc] 返回</span>
          {!isFinal && onAbort ? <span fg={C.dim}>  [a] 终止</span> : null}
          {children.length > 0 ? <span fg={C.dim}>  [↑↓] 选择子工具  [Enter] 查看详情</span> : null}
        </text>
      </box>
    </box>
  );
}
