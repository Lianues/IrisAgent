<template>
  <Transition name="approval-bar">
    <div v-if="askQuestionTools.length > 0 || pendingApprovals.length > 0" class="tool-approval-bar">
      <div
        v-for="tool in askQuestionTools"
        :key="tool.id"
        class="tool-approval-item"
      >
        <div class="tool-approval-info">
          <span class="tool-approval-name">AskQuestionFirst</span>
          <span class="tool-approval-args">请先回答以下问题</span>
        </div>
        <div class="tool-approval-question-list">
          <div
            v-for="question in getAskQuestions(tool)"
            :key="question.question"
            class="tool-approval-question"
          >
            <div class="tool-approval-question-title">{{ question.question }}</div>
            <label
              v-for="option in question.options"
              :key="option.label"
              class="tool-approval-question-option"
            >
              <input
                :type="question.multiSelect ? 'checkbox' : 'radio'"
                :name="`${tool.id}-${question.question}`"
                :value="option.label"
                :checked="question.multiSelect ? isMultiSelected(tool.id, question.question, option.label) : getAnswer(tool.id, question.question) === option.label"
                @change="question.multiSelect ? toggleMultiAnswer(tool.id, question.question, option.label) : setAnswer(tool.id, question.question, option.label)"
              />
              <span class="tool-approval-question-label">{{ option.label }}</span>
              <span v-if="option.description" class="tool-approval-question-desc">{{ option.description }}</span>
            </label>
            <div v-if="getSelectedPreview(tool.id, question)" class="tool-approval-question-preview">
              <div class="tool-approval-question-preview-title">Preview</div>
              <pre>{{ getSelectedPreview(tool.id, question) }}</pre>
            </div>
            <label class="tool-approval-question-option tool-approval-question-other">
              <input
                type="radio"
                :name="`${tool.id}-${question.question}`"
                value="__other__"
                :checked="isOtherSelected(tool.id, question.question, question.options)"
                @change="setAnswer(tool.id, question.question, getAnswer(tool.id, question.question) || '')"
              />
              <input
                class="tool-approval-question-input"
                type="text"
                placeholder="Other / 自定义答案"
                :value="isOtherSelected(tool.id, question.question, question.options) ? getAnswer(tool.id, question.question) : ''"
                @input="setAnswer(tool.id, question.question, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <div v-if="getUnansweredCount(tool) > 0" class="tool-approval-question-warning">
            仍有 {{ getUnansweredCount(tool) }} 个问题未回答；你仍可提交。
          </div>
        </div>
        <div class="tool-approval-actions">
          <button
            class="tool-approval-btn tool-approval-btn--reject"
            @click="chatAboutAskQuestion(tool.id)"
          >
            Chat about this
          </button>
          <button
            class="tool-approval-btn"
            @click="skipAskQuestion(tool.id)"
          >
            Skip interview
          </button>
          <button
            class="tool-approval-btn tool-approval-btn--reject"
            @click="cancelAskQuestion(tool.id)"
          >
            取消
          </button>
          <button
            class="tool-approval-btn tool-approval-btn--approve"
            @click="submitAskQuestion(tool.id)"
          >
            Submit answers
          </button>
        </div>
      </div>

      <div
        v-for="tool in pendingApprovals"
        :key="tool.id"
        class="tool-approval-item"
      >
        <div class="tool-approval-info">
          <span class="tool-approval-name">{{ tool.toolName }}</span>
          <span v-if="!isPlanApproval(tool)" class="tool-approval-args">{{ summarizeArgs(tool.args) }}</span>
          <span v-else class="tool-approval-args">计划审批</span>
        </div>
        <div v-if="isPlanApproval(tool)" class="tool-approval-plan">
          <div class="tool-approval-plan-path">计划文件：{{ getPlanApproval(tool).planFilePath || '未知' }}</div>
          <pre>{{ previewPlan(getPlanApproval(tool).plan || '') }}</pre>
        </div>
        <div class="tool-approval-actions">
          <button
            class="tool-approval-btn tool-approval-btn--reject"
            @click="approve(tool.id, false)"
          >
            {{ isPlanApproval(tool) ? '拒绝计划' : '拒绝' }} <kbd>N</kbd>
          </button>
          <button
            class="tool-approval-btn tool-approval-btn--approve"
            @click="approve(tool.id, true)"
          >
            {{ isPlanApproval(tool) ? '批准计划并执行' : '批准' }} <kbd>Y</kbd>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from 'vue'
import { useToolApproval } from '../composables/useToolApproval'
import type { ToolInvocation } from '../api/types'

type AskQuestionOption = { label: string; description?: string; preview?: string }
type AskQuestion = { question: string; header?: string; options: AskQuestionOption[]; multiSelect?: boolean }

const { toolInvocations, pendingApprovals, approve, sendMessage } = useToolApproval()
const askAnswers = reactive<Record<string, Record<string, string>>>({})

const askQuestionTools = computed(() => toolInvocations.value.filter((tool) => (
  tool.toolName === 'AskQuestionFirst'
  && tool.status === 'executing'
  && tool.progress?.kind === 'ask_question_first'
)))

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  const parts = entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v)
    return `${k}: ${val}`
  })
  if (entries.length > 3) parts.push(`+${entries.length - 3} more`)
  return parts.join(', ')
}

function getAskQuestions(tool: ToolInvocation): AskQuestion[] {
  const raw = tool.progress?.questions
  return Array.isArray(raw) ? raw as AskQuestion[] : []
}

function ensureAnswerBucket(toolId: string): Record<string, string> {
  if (!askAnswers[toolId]) askAnswers[toolId] = {}
  return askAnswers[toolId]
}

function getAnswer(toolId: string, question: string): string {
  return askAnswers[toolId]?.[question] ?? ''
}

function setAnswer(toolId: string, question: string, answer: string) {
  ensureAnswerBucket(toolId)[question] = answer
}

function isMultiSelected(toolId: string, question: string, label: string): boolean {
  return getAnswer(toolId, question).split(', ').filter(Boolean).includes(label)
}

function toggleMultiAnswer(toolId: string, question: string, label: string) {
  const current = getAnswer(toolId, question).split(', ').filter(Boolean)
  const next = current.includes(label)
    ? current.filter(item => item !== label)
    : [...current, label]
  setAnswer(toolId, question, next.join(', '))
}

function isOtherSelected(toolId: string, question: string, options: AskQuestionOption[]): boolean {
  const answer = getAnswer(toolId, question)
  return !!answer && !options.some(option => option.label === answer)
}

function getSelectedPreview(toolId: string, question: AskQuestion): string {
  const answer = getAnswer(toolId, question.question)
  return question.options.find(option => option.label === answer)?.preview ?? ''
}

function getUnansweredCount(tool: ToolInvocation): number {
  return getAskQuestions(tool).filter(question => !getAnswer(tool.id, question.question).trim()).length
}

function submitAskQuestion(toolId: string) {
  void sendMessage(toolId, 'ask_question_first:submit', { answers: askAnswers[toolId] ?? {} })
}

function chatAboutAskQuestion(toolId: string) {
  void sendMessage(toolId, 'ask_question_first:chat_about_this', { answers: askAnswers[toolId] ?? {} })
}

function skipAskQuestion(toolId: string) {
  void sendMessage(toolId, 'ask_question_first:skip_interview', { answers: askAnswers[toolId] ?? {} })
}

function cancelAskQuestion(toolId: string) {
  void sendMessage(toolId, 'ask_question_first:cancel', { reason: '用户取消了 AskQuestionFirst 问答。' })
}

function getPlanApproval(tool: any): { plan?: string; planFilePath?: string } {
  const progress = tool?.progress
  if (!progress || progress.kind !== 'plan_approval') return {}
  return {
    plan: typeof progress.plan === 'string' ? progress.plan : undefined,
    planFilePath: typeof progress.planFilePath === 'string' ? progress.planFilePath : undefined,
  }
}

function isPlanApproval(tool: any): boolean {
  return tool?.toolName === 'ExitPlanMode' && tool?.progress?.kind === 'plan_approval'
}

function previewPlan(plan: string): string {
  if (!plan.trim()) return '正在读取计划内容…'
  const lines = plan.trim().split(/\r?\n/)
  const shown = lines.slice(0, 24).join('\n')
  return lines.length > 24 ? `${shown}\n…` : shown
}

function handleKeydown(e: KeyboardEvent) {
  if (pendingApprovals.value.length === 0) return
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  const first = pendingApprovals.value[0]
  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    approve(first.id, true)
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    approve(first.id, false)
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<style scoped>
.tool-approval-plan,
.tool-approval-question-list {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  max-height: 360px;
  overflow: auto;
}

.tool-approval-plan-path {
  opacity: 0.7;
  font-size: 12px;
  margin-bottom: 8px;
}

.tool-approval-plan pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 13px;
}

.tool-approval-question {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.tool-approval-question-title {
  font-weight: 600;
}

.tool-approval-question-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.tool-approval-question-label {
  font-weight: 500;
}

.tool-approval-question-desc {
  opacity: 0.7;
}

.tool-approval-question-input {
  flex: 1;
  min-width: 220px;
}

.tool-approval-question-preview {
  margin: 4px 0 4px 24px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}

.tool-approval-question-preview-title,
.tool-approval-question-warning {
  opacity: 0.75;
  font-size: 12px;
}

.tool-approval-question-preview pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
