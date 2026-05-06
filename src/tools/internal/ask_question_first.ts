import type { ToolDefinition, ToolExecutionContext } from '../../types';
import { getActiveSessionId } from '../../core/backend/session-context';

export const ASK_QUESTION_FIRST_TOOL_NAME = 'AskQuestionFirst';

type AskQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

type AskQuestionItem = {
  question: string;
  header?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
};

type AskQuestionFirstArgs = {
  questions: AskQuestionItem[];
};

type AskQuestionFirstSubmitMessage = {
  answers?: Record<string, string>;
  annotations?: Record<string, { notes?: string; preview?: string }>;
};

type AskQuestionFirstMessage =
  | { type: 'submit'; payload: AskQuestionFirstSubmitMessage }
  | { type: 'chat_about_this'; payload?: AskQuestionFirstSubmitMessage }
  | { type: 'skip_interview'; payload?: AskQuestionFirstSubmitMessage }
  | { type: 'cancel'; payload?: { reason?: string } };

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeQuestions(raw: unknown): { questions?: AskQuestionItem[]; error?: string } {
  if (!Array.isArray(raw)) {
    return { error: 'questions 必须是数组。' };
  }
  if (raw.length < 1 || raw.length > 4) {
    return { error: 'questions 数量必须在 1 到 4 之间。' };
  }

  const questions: AskQuestionItem[] = [];
  const seenQuestions = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: `questions[${i}] 必须是对象。` };
    }
    const obj = item as Record<string, unknown>;
    const question = normalizeString(obj.question);
    if (!question) return { error: `questions[${i}].question 不能为空。` };
    if (seenQuestions.has(question)) return { error: `问题文本不能重复: ${question}` };
    seenQuestions.add(question);

    const optionsRaw = obj.options;
    if (!Array.isArray(optionsRaw) || optionsRaw.length < 2 || optionsRaw.length > 4) {
      return { error: `questions[${i}].options 必须包含 2 到 4 个选项。` };
    }

    const options: AskQuestionOption[] = [];
    const seenLabels = new Set<string>();
    for (let j = 0; j < optionsRaw.length; j++) {
      const optionRaw = optionsRaw[j];
      if (!optionRaw || typeof optionRaw !== 'object' || Array.isArray(optionRaw)) {
        return { error: `questions[${i}].options[${j}] 必须是对象。` };
      }
      const optionObj = optionRaw as Record<string, unknown>;
      const label = normalizeString(optionObj.label);
      if (!label) return { error: `questions[${i}].options[${j}].label 不能为空。` };
      if (seenLabels.has(label)) return { error: `同一问题内选项 label 不能重复: ${label}` };
      seenLabels.add(label);
      options.push({
        label,
        description: normalizeString(optionObj.description) || undefined,
        preview: normalizeString(optionObj.preview) || undefined,
      });
    }

    questions.push({
      question,
      header: normalizeString(obj.header) || undefined,
      options,
      multiSelect: obj.multiSelect === true,
    });
  }

  return { questions };
}

function waitForUserAnswer(context: ToolExecutionContext, signal?: AbortSignal): Promise<AskQuestionFirstMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: (() => void) | undefined;

    const cleanup = () => {
      if (dispose) {
        try { dispose(); } catch { /* ignore */ }
        dispose = undefined;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (message: AskQuestionFirstMessage) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(message);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('用户问答已被中止'));
    };

    if (signal?.aborted) {
      settled = true;
      reject(new Error('用户问答已被中止'));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    dispose = context.onMessage?.((type, data) => {
      if (type === 'ask_question_first:submit') {
        const payload = (data && typeof data === 'object') ? data as AskQuestionFirstSubmitMessage : {};
        finish({ type: 'submit', payload });
        return;
      }
      if (type === 'ask_question_first:chat_about_this') {
        const payload = (data && typeof data === 'object') ? data as AskQuestionFirstSubmitMessage : undefined;
        finish({ type: 'chat_about_this', payload });
        return;
      }
      if (type === 'ask_question_first:skip_interview') {
        const payload = (data && typeof data === 'object') ? data as AskQuestionFirstSubmitMessage : undefined;
        finish({ type: 'skip_interview', payload });
        return;
      }
      if (type === 'ask_question_first:cancel') {
        const payload = (data && typeof data === 'object') ? data as { reason?: string } : undefined;
        finish({ type: 'cancel', payload });
      }
    });

    if (!dispose) {
      cleanup();
      reject(new Error('当前执行上下文不支持交互式问答。'));
    }
  });
}

function summarizeAnswers(answers: Record<string, string>): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '用户没有提供答案。';
  return entries.map(([question, answer]) => `"${question}"="${answer}"`).join('\n');
}

export function createAskQuestionFirstTool(): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: ASK_QUESTION_FIRST_TOOL_NAME,
      description: `当用户指令不够清晰、需求有歧义、或存在多个合理技术路线时，先用这个工具向用户提出结构化选择题，再继续任务。\n\n适用场景：澄清需求、收集偏好、让用户在 2-4 个方案中选择、确认重要取舍。\n重要交互规则：如果决定使用本工具，必须直接调用工具，不要先输出“好的，我先问你...”之类的普通文本或过渡说明；前置文本会让用户看到文字但暂时看不到交互面板，像是 TUI 卡住。\n不要用它询问“计划是否批准/是否开始执行”；计划批准应使用 ExitPlanMode。\n简单明确任务不要调用。用户界面还提供“Chat about this”和“Skip interview and plan immediately”，你会在工具结果中收到相应指示。`,
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '要询问用户的问题数组，1-4 个。每个问题包含 question/header/options/multiSelect。options 为 2-4 个选项，每个选项包含 label/description/preview。',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description: '要询问用户的问题文本。',
                },
                header: {
                  type: 'string',
                  description: '可选的问题分组标题或提示标题。',
                },
                options: {
                  type: 'array',
                  description: '选项数组，2-4 个。',
                  minItems: 2,
                  maxItems: 4,
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description: '选项显示文本。',
                      },
                      description: {
                        type: 'string',
                        description: '可选的选项说明。',
                      },
                      preview: {
                        type: 'string',
                        description: '可选的选项预览内容。',
                      },
                    },
                    required: ['label'],
                  },
                },
                multiSelect: {
                  type: 'boolean',
                  description: '是否允许多选。默认 false。',
                },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
    handler: async (args, context) => {
      const sessionId = getActiveSessionId();
      if (typeof sessionId === 'string' && sessionId.startsWith('cross-agent:')) {
        return {
          error: 'AskQuestionFirst 只能在前台主会话中使用，不能在跨 Agent 后台会话中使用。',
        };
      }
      if (!context?.reportProgress || !context.onMessage) {
        return {
          error: '当前执行上下文不支持交互式问答。请直接向用户提出文字问题，或在 Console/Web 前台会话中使用 AskQuestionFirst。',
        };
      }

      const normalized = normalizeQuestions((args as Partial<AskQuestionFirstArgs>).questions);
      if (normalized.error || !normalized.questions) {
        return { error: normalized.error ?? 'AskQuestionFirst 参数无效。' };
      }

      const questions = normalized.questions;
      context.reportProgress({
        kind: 'ask_question_first',
        questions,
        status: 'waiting',
      });

      const message = await waitForUserAnswer(context, context.signal);
      if (message.type === 'cancel') {
        return {
          cancelled: true,
          message: message.payload?.reason || '用户取消了问答。请根据已有信息继续，或用普通文本重新澄清。',
        };
      }

      if (message.type === 'chat_about_this') {
        const answers = message.payload?.answers ?? {};
        return {
          action: 'chat_about_this',
          questions,
          answers,
          message: `用户希望先讨论这些问题或选项，而不是直接提交答案。请询问用户想澄清什么，或根据已有反馈重新组织问题。\n${summarizeAnswers(answers)}`,
        };
      }

      if (message.type === 'skip_interview') {
        const answers = message.payload?.answers ?? {};
        return {
          action: 'skip_interview',
          questions,
          answers,
          message: `用户表示已经提供足够信息，不要继续进行问答访谈。请停止追问，基于已有信息继续完成计划或任务。\n${summarizeAnswers(answers)}`,
        };
      }

      const answers = message.payload.answers ?? {};
      const annotations = message.payload.annotations;
      const summary = summarizeAnswers(answers);
      return {
        questions,
        answers,
        ...(annotations ? { annotations } : {}),
        message: `用户已经回答了你的问题。请基于这些答案继续任务。\n${summary}`,
      };
    },
  };
}
