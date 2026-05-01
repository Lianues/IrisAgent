/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

export interface ExtensionItem {
  name: string;
  version: string;
  description: string;
  status: 'active' | 'disabled' | 'available' | 'platform';
  /** 进入 /extension 时的真实状态；status 是当前草稿状态。 */
  originalStatus?: 'active' | 'disabled' | 'available' | 'platform';
  hasPlugin: boolean;
  source: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'active', color: '#2ecc71' },
  disabled: { label: 'disabled', color: '#e74c3c' },
  available: { label: 'available', color: '#f39c12' },
  platform: { label: 'platform', color: '#95a5a6' },
};

interface ExtensionListViewProps {
  extensions: ExtensionItem[];
  selectedIndex: number;
  /** 正在切换中的扩展名（显示 loading 状态） */
  togglingName: string | null;
  /** 最近一次操作的状态消息 */
  statusMessage: string | null;
  statusIsError: boolean;
}

export function ExtensionListView({
  extensions,
  selectedIndex,
  togglingName,
  statusMessage,
  statusIsError,
}: ExtensionListViewProps) {
  const total = extensions.length;
  const pluginCount = extensions.filter((item) => item.hasPlugin).length;
  const platformCount = total - pluginCount;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>{`${ICONS.bullet} `}</text>
        <text fg={C.primary}>{'Extension '}</text>
        <text fg={C.dim}>{`(${pluginCount} plugins, ${platformCount} platforms)`}</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 标记  S 保存  Esc 返回`}</text>
      </box>
      {statusMessage && (
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={statusIsError ? C.error : C.accent}>{statusMessage}</text>
        </box>
      )}
      <scrollbox flexGrow={1}>
        {extensions.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>
            {'No extensions found.'}
          </text>
        )}
        {extensions.map((item, index) => {
          const isSelected = index === selectedIndex;
          const statusInfo = STATUS_LABELS[item.status] ?? STATUS_LABELS.platform;
          const isToggling = item.name === togglingName;
          const isDirty = item.originalStatus != null && item.originalStatus !== item.status;
          const showHeader = index === 0 || extensions[index - 1]?.hasPlugin !== item.hasPlugin;

          return (
            <box key={item.name} flexDirection="column">
              {showHeader && <text fg={C.primary}>{item.hasPlugin ? 'Plugins' : 'Platforms'}</text>}
              <box paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>
                  {isSelected ? `${ICONS.selectorArrow} ` : '  '}
                </span>
                <span fg={statusInfo.color}>{`[${isToggling ? '...' : `${statusInfo.label}${isDirty ? '*' : ''}`}] `}</span>
                {isSelected
                  ? <strong><span fg={C.text}>{item.name}</span></strong>
                  : <span fg={C.textSec}>{item.name}</span>}
                <span fg={C.dim}>{` v${item.version}`}</span>
                <span fg={C.dim}>{` ${ICONS.emDash} ${item.description || '(no description)'}`}</span>
              </text>
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
