/** @jsxImportSource @opentui/react */

import React, { useEffect, useMemo, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ToolInvocation } from 'irises-extension-sdk';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
import { useTextInput } from '../hooks/use-text-input';
import { InputDisplay } from './InputDisplay';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { MarkdownText } from './MarkdownText';

type QuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

type Question = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

interface AskQuestionFirstPanelProps {
  invocation: ToolInvocation;
  onToolMessage: (toolId: string, type: string, data?: unknown) => void;
  planModeActive?: boolean;
}

function getQuestions(invocation: ToolInvocation): Question[] {
  const progress = invocation.progress as Record<string, unknown> | undefined;
  const raw = progress?.kind === 'ask_question_first' ? progress.questions : undefined;
  return Array.isArray(raw) ? raw as Question[] : [];
}

function truncate(text: string | undefined, max = 90): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}${ICONS.ellipsis}` : text;
}

function normalizeAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value ?? '';
}

function buildPreviewWindow(
  text: string | undefined,
  maxLines: number,
  scroll: number,
): { text: string; hiddenBefore: number; hiddenAfter: number; maxScroll: number; totalLines: number } | undefined {
  if (!text?.trim()) return undefined;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length <= maxLines) {
    return { text, hiddenBefore: 0, hiddenAfter: 0, maxScroll: 0, totalLines: lines.length };
  }

  const maxScroll = Math.max(0, lines.length - maxLines);
  const start = Math.max(0, Math.min(scroll, maxScroll));
  const end = start + maxLines;
  return {
    text: lines.slice(start, end).join('\n'),
    hiddenBefore: start,
    hiddenAfter: Math.max(0, lines.length - end),
    maxScroll,
    totalLines: lines.length,
  };
}

export function AskQuestionFirstPanel({ invocation, onToolMessage, planModeActive }: AskQuestionFirstPanelProps) {
  const { width: rawTermWidth } = useTerminalDimensions();
  const termWidth = Math.max(60, rawTermWidth - 6);
  const questions = getQuestions(invocation);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewChoice, setReviewChoice] = useState<'submit' | 'cancel'>('submit');
  const [otherInputMode, setOtherInputMode] = useState(false);
  const [sentAction, setSentAction] = useState<string | null>(null);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [otherState, otherActions] = useTextInput('');
  const cursorVisible = useCursorBlink();

  const current = questions[currentIndex];
  const optionCount = (current?.options.length ?? 0) + 1; // + Other

  const submittedAnswers = useMemo(() => {
    const result: Record<string, string> = {};
    for (const question of questions) {
      result[question.question] = normalizeAnswer(answers[question.question]);
    }
    return result;
  }, [answers, questions]);

  const unansweredCount = questions.filter(question => !submittedAnswers[question.question]).length;

  const commitAnswer = (question: Question, answer: string | string[], shouldAdvance = true) => {
    setAnswers((prev) => ({ ...prev, [question.question]: answer }));
    if (!shouldAdvance) return;
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(0);
      setOtherInputMode(false);
      otherActions.setValue('');
    } else {
      setReviewMode(true);
      setOtherInputMode(false);
      otherActions.setValue('');
    }
  };

  const toggleMultiAnswer = (question: Question, label: string) => {
    const currentAnswer = answers[question.question];
    const list = Array.isArray(currentAnswer) ? currentAnswer : (typeof currentAnswer === 'string' && currentAnswer ? currentAnswer.split(', ').filter(Boolean) : []);
    const next = list.includes(label) ? list.filter(item => item !== label) : [...list, label];
    commitAnswer(question, next, false);
  };

  const getExistingOtherText = (question: Question): string => {
    const answer = normalizeAnswer(answers[question.question]);
    if (!answer) return '';
    const optionLabels = new Set(question.options.map(option => option.label));
    return optionLabels.has(answer) ? '' : answer;
  };

  const submit = () => {
    if (sentAction) return;
    setSentAction('submit');
    onToolMessage(invocation.id, 'ask_question_first:submit', { answers: submittedAnswers });
  };

  const cancel = () => {
    if (sentAction) return;
    setSentAction('cancel');
    onToolMessage(invocation.id, 'ask_question_first:cancel', { reason: '用户取消了 AskQuestionFirst 问答。' });
  };

  const chatAboutThis = () => {
    if (sentAction) return;
    setSentAction('chat_about_this');
    onToolMessage(invocation.id, 'ask_question_first:chat_about_this', { answers: submittedAnswers });
  };

  const skipInterview = () => {
    if (sentAction) return;
    setSentAction('skip_interview');
    onToolMessage(invocation.id, 'ask_question_first:skip_interview', { answers: submittedAnswers });
  };

  const selectedOption = current && selectedIndex < current.options.length ? current.options[selectedIndex] : undefined;
  const previewSource = selectedOption?.preview || selectedOption?.description;
  const useSideBySide = !!previewSource && !otherInputMode && termWidth >= 100;
  const previewMaxLines = useSideBySide ? 10 : 6;
  const leftWidth = Math.min(44, Math.max(32, Math.floor(termWidth * 0.42)));
  const preview = buildPreviewWindow(previewSource, previewMaxLines, previewScroll);

  useEffect(() => {
    setPreviewScroll(0);
  }, [currentIndex, selectedIndex, previewSource]);

  const scrollPreview = (delta: number) => {
    if (!preview || preview.maxScroll <= 0) return;
    setPreviewScroll((prev) => Math.max(0, Math.min(preview.maxScroll, prev + delta)));
  };

  useKeyboard((key) => {
    if (sentAction) return;

    if (questions.length === 0) return;

    if (otherInputMode && current) {
      if (key.name === 'escape') {
        setOtherInputMode(false);
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        const text = otherState.value.trim();
        if (text) {
          if (current.multiSelect) {
            toggleMultiAnswer(current, text);
            setOtherInputMode(false);
            otherActions.setValue('');
          } else {
            commitAnswer(current, text, true);
          }
        }
        return;
      }
      otherActions.handleKey(key);
      return;
    }

    if (key.name === 'c' && !key.ctrl && !key.meta) { chatAboutThis(); return; }
    if (planModeActive && key.name === 'p' && !key.ctrl && !key.meta) { skipInterview(); return; }

    if (!reviewMode && preview && preview.maxScroll > 0) {
      const pageStep = Math.max(1, Math.floor(previewMaxLines / 2));
      if ((key.ctrl || key.shift) && key.name === 'up') { scrollPreview(-1); return; }
      if ((key.ctrl || key.shift) && key.name === 'down') { scrollPreview(1); return; }
      if ((key.ctrl || key.shift) && key.name === 'pageup') { scrollPreview(-pageStep); return; }
      if ((key.ctrl || key.shift) && key.name === 'pagedown') { scrollPreview(pageStep); return; }
      if (key.sequence === '[') { scrollPreview(-1); return; }
      if (key.sequence === ']') { scrollPreview(1); return; }
    }

    if (reviewMode) {
      if (key.name === 'backspace' || key.name === 'escape') {
        setReviewMode(false);
        setCurrentIndex(Math.max(0, questions.length - 1));
        return;
      }
      if (key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down' || key.name === 'tab') {
        setReviewChoice((prev) => prev === 'submit' ? 'cancel' : 'submit');
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        reviewChoice === 'submit' ? submit() : cancel();
        return;
      }
      if (key.name === 'y' || key.name === 's') { submit(); return; }
      if (key.name === 'n') { cancel(); return; }
      return;
    }

    if (!current) return;
    if (key.name === 'escape') { cancel(); return; }
    if (key.name === 'left' || key.name === 'backspace' || key.name === 'pageup') {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
      setSelectedIndex(0);
      return;
    }
    if (key.name === 'right' || key.name === 'pagedown') {
      setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
      setSelectedIndex(0);
      return;
    }
    if (key.name === 'up') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.name === 'down') {
      setSelectedIndex((prev) => Math.min(optionCount - 1, prev + 1));
      return;
    }
    if (key.name === 'tab') {
      if (currentIndex < questions.length - 1) setCurrentIndex((prev) => prev + 1);
      else setReviewMode(true);
      setSelectedIndex(0);
      return;
    }
    if (key.sequence && /^[1-9]$/.test(key.sequence)) {
      const index = Number(key.sequence) - 1;
      if (index >= 0 && index < optionCount) setSelectedIndex(index);
      return;
    }
    if (key.name === 'enter' || key.name === 'return' || key.sequence === ' ') {
      if (selectedIndex === current.options.length) {
        setOtherInputMode(true);
        otherActions.setValue(getExistingOtherText(current));
        return;
      }
      const selected = current.options[selectedIndex];
      if (!selected) return;
      if (current.multiSelect) {
        toggleMultiAnswer(current, selected.label);
      } else {
        commitAnswer(current, selected.label, true);
      }
      return;
    }
    if (current.multiSelect && key.name === 'n') {
      if (currentIndex < questions.length - 1) setCurrentIndex((prev) => prev + 1);
      else setReviewMode(true);
    }
  });

  if (questions.length === 0) {
    return (
      <box borderStyle="single" borderColor={C.warn} paddingX={1}>
        <text fg={C.warn}>AskQuestionFirst 正在等待选项数据…</text>
      </box>
    );
  }

  const renderFooterHints = () => (
    <box flexDirection="column">
      <text fg={C.dim}>↑/↓ 选择 · Enter 确认{current?.multiSelect ? ' · N/Tab 继续' : ''} · ←/Backspace 返回 · →继续 · Esc 取消</text>
      <text fg={C.dim}>C 先讨论{planModeActive ? ' · P 跳过访谈并立即规划' : ''}</text>
    </box>
  );

  if (sentAction) {
    return (
      <box borderStyle="single" borderColor={C.warn} paddingX={1}><text fg={C.warn}>AskQuestionFirst 已提交，正在等待模型继续…</text></box>
    );
  }

  if (reviewMode) {
    return (
      <box flexDirection="column" borderStyle="single" borderColor={C.warn} paddingX={1} paddingY={0}>
        <text><span fg={C.warn}><strong>? AskQuestionFirst</strong></span><span fg={C.text}> · 确认并提交？</span></text>
        {unansweredCount > 0 ? (
          <text fg={C.warn}>{ICONS.warning} 仍有 {unansweredCount} 项未回答；你仍可提交。</text>
        ) : null}
        <box flexDirection="column" marginTop={1}>
          {questions.map((question, index) => (
            <text key={question.question}>
              <span fg={C.dim}>{index + 1}. </span>
              <span fg={C.text}>{question.question}</span>
              <span fg={C.dim}> → </span>
              <span fg={submittedAnswers[question.question] ? C.accent : C.warn}>{submittedAnswers[question.question] || '(未回答)'}</span>
            </text>
          ))}
        </box>
        <text>
          <span fg={reviewChoice === 'submit' ? C.accent : C.textSec}>{reviewChoice === 'submit' ? '[(Enter)提交]' : ' (Enter)提交 '}</span>
          <span fg={C.dim}> </span>
          <span fg={reviewChoice === 'cancel' ? C.error : C.textSec}>{reviewChoice === 'cancel' ? '[(N)取消]' : ' (N)取消 '}</span>
          <span fg={C.dim}>  ←/→ 选择 · Backspace/Esc 返回修改</span>
        </text>
        <text fg={C.dim}>C 先讨论{planModeActive ? ' · P 跳过访谈并立即规划' : ''}</text>
      </box>
    );
  }

  const answered = current ? normalizeAnswer(answers[current.question]) : '';

  const optionList = (
    <box flexDirection="column" width={useSideBySide ? leftWidth : undefined} flexShrink={0}>
      {current?.options.map((option, index) => {
        const selected = index === selectedIndex;
        const multiSelected = Array.isArray(answers[current.question]) && (answers[current.question] as string[]).includes(option.label);
        return (
          <text key={`${current.question}-${option.label}`}>
            <span fg={selected ? C.warn : C.dim}>{selected ? ICONS.selectorArrow : ' '} {index + 1}. </span>
            {current.multiSelect ? <span fg={multiSelected ? C.accent : C.dim}>[{multiSelected ? ICONS.checkmark : ' '}] </span> : null}
            <span fg={multiSelected ? C.accent : (selected ? C.text : C.textSec)}><strong>{option.label}</strong></span>
            {option.description ? <span fg={C.dim}> — {truncate(option.description, useSideBySide ? Math.max(18, leftWidth - option.label.length - 10) : 90)}</span> : null}
          </text>
        );
      })}
      <text>
        <span fg={selectedIndex === current!.options.length ? C.warn : C.dim}>{selectedIndex === current!.options.length ? ICONS.selectorArrow : ' '} {current!.options.length + 1}. </span>
        <span fg={selectedIndex === current!.options.length ? C.text : C.textSec}><strong>Other</strong></span>
        <span fg={C.dim}> — 自定义答案</span>
      </text>
    </box>
  );

  const previewPane = preview ? (
    <box flexDirection="column" flexGrow={1} marginTop={useSideBySide ? 0 : 1} paddingLeft={1} borderStyle="single" borderColor={C.border}>
      <text>
        <span fg={C.dim}>Preview</span>
        {preview.maxScroll > 0 ? <span fg={C.dim}>  {Math.min(preview.hiddenBefore + 1, preview.totalLines)}-{preview.hiddenBefore + preview.text.split('\n').length}/{preview.totalLines}</span> : null}
      </text>
      {preview.hiddenBefore > 0 ? <text fg={C.dim}>{ICONS.ellipsis} +{preview.hiddenBefore} lines above</text> : null}
      <MarkdownText text={preview.text} />
      {preview.hiddenAfter > 0 ? <text fg={C.dim}>{ICONS.ellipsis} +{preview.hiddenAfter} lines below</text> : null}
      {preview.maxScroll > 0 ? <text fg={C.dim}>Ctrl+↑/↓ 或 [ / ] 滚动预览</text> : null}
    </box>
  ) : null;

  return (
    <box flexDirection="column" borderStyle="single" borderColor={C.warn} paddingX={1} paddingY={0}>
      <text>
        <span fg={C.warn}><strong>? AskQuestionFirst</strong></span>
        <span fg={C.dim}>  {currentIndex + 1}/{questions.length}</span>
        {current?.header ? <span fg={C.dim}> · {current.header}</span> : null}
      </text>
      <text><span fg={C.text}>{current?.question}</span></text>
      <box flexDirection={useSideBySide ? 'row' : 'column'} marginTop={1} gap={useSideBySide ? 2 : 0}>
        {optionList}
        {previewPane}
      </box>
      {otherInputMode ? (
        <box marginTop={1}>
          <text fg={C.accent}>{ICONS.selectorArrow} </text>
          <InputDisplay value={otherState.value} cursor={otherState.cursor} isActive={true} cursorVisible={cursorVisible} placeholder="输入自定义答案，Enter 确认，Esc 返回" />
        </box>
      ) : null}
      {answered ? <text fg={C.dim}>当前答案：{answered}</text> : null}
      {renderFooterHints()}
    </box>
  );
}
