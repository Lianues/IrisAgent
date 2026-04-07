/** @jsxImportSource @opentui/react */

import React from 'react';
import type { IrisModelInfoLike as LLMModelInfo } from '@irises/extension-sdk';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface ModelListViewProps {
  models: LLMModelInfo[];
  selectedIndex: number;
}

export function ModelListView({ models, selectedIndex }: ModelListViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>切换模型</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 切换  Esc 返回`}</text>
      </box>
      <scrollbox flexGrow={1}>
        {models.map((info, index) => {
          const isSelected = index === selectedIndex;
          const currentMarker = info.current ? ICONS.bullet : ' ';
          return (
            <box key={info.modelName} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? `${ICONS.selectorArrow} ` : '  '}</span>
                <span fg={info.current ? C.accent : C.dim}>{currentMarker} </span>
                {isSelected
                  ? <strong><span fg={C.text}>{info.modelName}</span></strong>
                  : <span fg={C.textSec}>{info.modelName}</span>}
                <span fg={C.dim}>  {info.modelId}  {info.provider}</span>
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
