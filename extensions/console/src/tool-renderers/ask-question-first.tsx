/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
import type { ToolRendererProps } from './default';

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}${ICONS.ellipsis}` : text;
}

export function AskQuestionFirstRenderer({ result }: ToolRendererProps) {
  const record = (result && typeof result === 'object' && !Array.isArray(result))
    ? result as Record<string, unknown>
    : {};

  if (record.cancelled === true) {
    return <text fg={C.warn}><em> {ICONS.resultArrow} 用户取消了问答</em></text>;
  }

  if (record.action === 'chat_about_this') {
    return <text fg={C.warn}><em> {ICONS.resultArrow} 用户选择先讨论这些问题</em></text>;
  }

  if (record.action === 'skip_interview') {
    return <text fg={C.warn}><em> {ICONS.resultArrow} 用户跳过访谈，要求直接继续规划</em></text>;
  }

  const answers = (record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers))
    ? record.answers as Record<string, unknown>
    : {};
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return <text fg={C.dim}><em> {ICONS.resultArrow} 未提供答案</em></text>;
  }

  const preview = entries
    .slice(0, 3)
    .map(([question, answer]) => `${truncate(question, 36)} → ${truncate(String(answer), 42)}`)
    .join('; ');
  const suffix = entries.length > 3 ? ` (+${entries.length - 3})` : '';

  return <text fg={C.dim}><em> {ICONS.resultArrow} 用户已回答 {entries.length} 个问题：{preview}{suffix}</em></text>;
}
