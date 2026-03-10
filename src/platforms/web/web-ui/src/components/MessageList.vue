<template>
  <div ref="containerEl" class="messages">
    <div class="messages-shell">
      <div v-if="messages.length === 0 && !isStreaming" class="welcome">
        <div class="welcome-badge">Iris Workspace</div>
        <h2>把灵感、问题和工具流都放进一个对话里</h2>
        <p>
          支持流式响应、多会话记录与工具调用，适合长时间沉浸式协作。
        </p>

        <div class="welcome-tips">
          <div class="welcome-tip">
            <strong>流式回复</strong>
            <span>边生成边阅读，长输出也能保持顺滑。</span>
          </div>
          <div class="welcome-tip">
            <strong>工具调用</strong>
            <span>把搜索、文件与命令结果折叠进同一条工作流。</span>
          </div>
          <div class="welcome-tip">
            <strong>多会话记录</strong>
            <span>保留上下文脉络，像工作台一样持续推进任务。</span>
          </div>
        </div>
      </div>

      <template v-for="(msg, i) in messages" :key="i">
        <!-- 工具折叠按钮：当消息包含工具部分时显示 -->
        <button
          v-if="hasToolParts(msg) && getTextPartIndex(msg) === -1"
          class="tool-collapse-btn"
          :class="{ expanded: !collapsedTools.has(i) }"
          type="button"
          @click="toggleToolCollapse(i)"
        >
          <AppIcon :name="ICONS.common.chevronRight" class="collapse-icon" />
          {{ collapsedTools.has(i) ? `${countToolParts(msg)} 个工具调用（点击展开）` : '折叠工具调用' }}
        </button>

        <template v-for="(part, j) in msg.parts" :key="`${i}-${j}`">
          <MessageBubble
            v-if="part.type === 'text' && part.text?.trim()"
            :role="msg.role"
            :text="part.text!"
            @retry="emit('retry')"
          />

          <!-- 工具折叠按钮：紧跟在文本后、工具部分前显示 -->
          <button
            v-if="part.type === 'text' && part.text?.trim() && hasToolParts(msg) && isLastTextPart(msg, j)"
            class="tool-collapse-btn"
            :class="{ expanded: !collapsedTools.has(i) }"
            type="button"
            @click="toggleToolCollapse(i)"
          >
            <AppIcon :name="ICONS.common.chevronRight" class="collapse-icon" />
            {{ collapsedTools.has(i) ? `${countToolParts(msg)} 个工具调用（点击展开）` : '折叠工具调用' }}
          </button>

          <ToolBlock
            v-else-if="part.type === 'function_call'"
            type="call"
            :name="part.name!"
            :data="part.args"
            :collapsed="collapsedTools.has(i)"
          />
          <ToolBlock
            v-else-if="part.type === 'function_response'"
            type="response"
            :name="part.name!"
            :data="part.response"
            :collapsed="collapsedTools.has(i)"
          />
        </template>
      </template>

      <MessageBubble
        v-if="isStreaming && streamingText"
        role="model"
        :text="streamingText"
        :streaming="true"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick } from 'vue'
import type { Message } from '../api/types'
import MessageBubble from './MessageBubble.vue'
import ToolBlock from './ToolBlock.vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const props = defineProps<{
  messages: Message[]
  streamingText: string
  isStreaming: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const containerEl = ref<HTMLElement>()

/** 记录哪些消息索引的工具被折叠 */
const collapsedTools = reactive(new Set<number>())

function hasToolParts(msg: Message): boolean {
  return msg.parts.some(p => p.type === 'function_call' || p.type === 'function_response')
}

function countToolParts(msg: Message): number {
  return msg.parts.filter(p => p.type === 'function_call' || p.type === 'function_response').length
}

/** 获取消息中第一个有效文本部分的索引，没有则返回 -1 */
function getTextPartIndex(msg: Message): number {
  return msg.parts.findIndex(p => p.type === 'text' && p.text?.trim())
}

/** 判断当前 part 是否是消息中最后一个有效文本部分 */
function isLastTextPart(msg: Message, partIndex: number): boolean {
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    if (msg.parts[i].type === 'text' && msg.parts[i].text?.trim()) {
      return i === partIndex
    }
  }
  return false
}

function toggleToolCollapse(msgIndex: number) {
  if (collapsedTools.has(msgIndex)) {
    collapsedTools.delete(msgIndex)
  } else {
    collapsedTools.add(msgIndex)
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (containerEl.value) {
      containerEl.value.scrollTop = containerEl.value.scrollHeight
    }
  })
}

// 非递增变化（会话切换、retry 等）清空折叠状态，仅正常 push（+1）时保留
watch(() => props.messages.length, (newLen, oldLen) => {
  if (newLen - (oldLen ?? 0) !== 1) {
    collapsedTools.clear()
  }
  scrollToBottom()
})
watch(() => props.streamingText, scrollToBottom)
</script>
