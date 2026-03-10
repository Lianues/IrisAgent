<template>
  <div class="input-area">
    <div class="input-shell">
      <div class="input-meta">
        <div class="input-title">继续当前工作流</div>
        <div class="input-hint">Enter 发送 · Shift + Enter 换行</div>
      </div>

      <div class="input-box">
        <textarea
          ref="inputEl"
          v-model="text"
          placeholder="给 Iris 发送消息..."
          rows="1"
          :disabled="disabled"
          @keydown.enter.exact.prevent="handleSend"
          @input="autoResize"
        ></textarea>

        <button
          class="btn-send"
          :disabled="disabled || !text.trim()"
          @click="handleSend"
        >
          <span class="btn-send-label">{{ disabled ? '生成中...' : '发送' }}</span>
          <AppIcon :name="ICONS.common.send" class="btn-send-icon" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)

function handleSend() {
  if (!text.value.trim()) return
  emit('send', text.value)
  text.value = ''
  nextTick(() => {
    if (inputEl.value) inputEl.value.style.height = 'auto'
  })
}

function autoResize() {
  if (inputEl.value) {
    inputEl.value.style.height = 'auto'
    inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 200) + 'px'
  }
}
</script>
