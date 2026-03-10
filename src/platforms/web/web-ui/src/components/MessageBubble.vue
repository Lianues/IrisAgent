<template>
  <div class="message-stack" :class="[`message-stack-${role}`, { streaming }]">
    <div class="message-meta-row">
      <div class="message-meta">{{ roleLabel }}</div>
      <div class="message-actions">
        <button class="message-action-btn" type="button" @click="copyMessage">
          {{ messageCopyText }}
        </button>
        <button
          v-if="role === 'model' && !streaming"
          class="message-action-btn"
          type="button"
          @click="emit('retry')"
        >
          重试
        </button>
      </div>
    </div>

    <div
      ref="messageEl"
      class="message"
      :class="[`message-${role}`, { streaming }]"
      v-html="renderedText"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  role: 'user' | 'model'
  text: string
  streaming?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const roleLabel = computed(() => (props.role === 'user' ? '你' : 'Iris'))
const messageEl = ref<HTMLDivElement | null>(null)
const messageCopyText = ref('复制')
let messageCopyTimer: number | null = null

/** 用户消息纯文本转义，模型消息 Markdown 渲染 */
const renderedText = computed(() => {
  if (props.role === 'user') {
    const div = document.createElement('div')
    div.textContent = props.text
    return div.innerHTML
  }
  return renderMarkdown(props.text)
})

function scheduleMessageCopyReset() {
  if (messageCopyTimer !== null) {
    window.clearTimeout(messageCopyTimer)
  }
  messageCopyTimer = window.setTimeout(() => {
    messageCopyText.value = '复制'
    messageCopyTimer = null
  }, 1800)
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.text)
    messageCopyText.value = '已复制'
  } catch {
    messageCopyText.value = '复制失败'
  }
  scheduleMessageCopyReset()
}

function resetCodeCopyButton(button: HTMLButtonElement) {
  button.textContent = '复制代码'
  button.classList.remove('copied', 'error')
}

function scheduleCodeCopyReset(button: HTMLButtonElement) {
  const timerId = button.dataset.resetTimer
  if (timerId) {
    window.clearTimeout(Number(timerId))
  }

  const nextTimerId = window.setTimeout(() => {
    resetCodeCopyButton(button)
    delete button.dataset.resetTimer
  }, 1800)

  button.dataset.resetTimer = String(nextTimerId)
}

async function copyCodeBlock(pre: HTMLElement, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(pre.innerText)
    button.textContent = '已复制'
    button.classList.remove('error')
    button.classList.add('copied')
  } catch {
    button.textContent = '复制失败'
    button.classList.remove('copied')
    button.classList.add('error')
  }

  scheduleCodeCopyReset(button)
}

function detectCodeLabel(pre: HTMLElement) {
  const code = pre.querySelector('code')
  const match = code?.className.match(/language-([\w-]+)/)
  return match?.[1]?.toUpperCase() || '代码片段'
}

function enhanceCodeBlocks() {
  if (props.role !== 'model' || !messageEl.value) return

  const blocks = Array.from(messageEl.value.querySelectorAll('pre'))
  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains('message-code-shell')) continue

    const shell = document.createElement('div')
    shell.className = 'message-code-shell'

    const toolbar = document.createElement('div')
    toolbar.className = 'message-code-toolbar'

    const label = document.createElement('span')
    label.className = 'message-code-label'
    label.textContent = detectCodeLabel(pre)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'message-code-copy'
    button.textContent = '复制代码'
    button.addEventListener('click', () => {
      void copyCodeBlock(pre, button)
    })

    toolbar.append(label, button)
    pre.parentNode?.insertBefore(shell, pre)
    shell.append(toolbar, pre)
  }
}

onMounted(() => {
  void nextTick(() => {
    enhanceCodeBlocks()
  })
})

watch(renderedText, () => {
  void nextTick(() => {
    enhanceCodeBlocks()
  })
})

onBeforeUnmount(() => {
  if (messageCopyTimer !== null) {
    window.clearTimeout(messageCopyTimer)
  }

  messageEl.value?.querySelectorAll<HTMLButtonElement>('.message-code-copy').forEach((button) => {
    const timerId = button.dataset.resetTimer
    if (timerId) {
      window.clearTimeout(Number(timerId))
    }
  })
})
</script>
