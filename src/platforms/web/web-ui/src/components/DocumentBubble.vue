<template>
  <div class="message-stack" :class="`message-stack-${role}`">
    <div class="message-meta-row">
      <div class="message-meta">{{ roleLabel }}</div>
    </div>

    <div
      class="doc-bubble"
      :class="[`doc-bubble-${role}`, { clickable: hasPreview }]"
      @click="hasPreview && (previewOpen = true)"
    >
      <AppIcon :name="ICONS.common.document" class="doc-bubble-icon" />
      <div class="doc-bubble-info">
        <span class="doc-bubble-name">{{ displayName }}</span>
        <span class="doc-bubble-type">{{ typeLabel }}</span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="doc-preview">
        <div v-if="previewOpen" class="doc-preview-overlay" @click.self="previewOpen = false">
          <div class="doc-preview-card">
            <div class="doc-preview-header">
              <span class="doc-preview-title">{{ displayName }}</span>
              <button class="doc-preview-close" type="button" aria-label="关闭" @click="previewOpen = false">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <pre class="doc-preview-content">{{ previewText }}</pre>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { getRoleLabel } from '../utils/role'

const props = defineProps<{
  role: 'user' | 'model'
  mimeType: string
  data?: string
  fileName?: string
  text?: string
}>()

const roleLabel = computed(() => getRoleLabel(props.role))
const previewOpen = ref(false)

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF 文档',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint 演示文稿',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel 表格',
  'application/vnd.ms-excel': 'Excel 表格',
}

const typeLabel = computed(() => MIME_LABELS[props.mimeType] ?? '文档')

const EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
}

const displayName = computed(() => {
  if (props.fileName) return props.fileName
  const ext = EXT_MAP[props.mimeType] ?? ''
  return `文档${ext}`
})

/** 二进制格式不适合文本预览 */
const BINARY_MIMES = new Set(Object.keys(MIME_LABELS))

const isTextDocument = computed(() => !BINARY_MIMES.has(props.mimeType))

const MAX_PREVIEW_LENGTH = 200_000

const previewText = computed(() => {
  if (props.text) {
    return props.text.length > MAX_PREVIEW_LENGTH
      ? props.text.slice(0, MAX_PREVIEW_LENGTH) + '\n\n... (内容过长，已截断)'
      : props.text
  }
  if (props.data && isTextDocument.value) {
    try {
      const bytes = Uint8Array.from(atob(props.data), c => c.charCodeAt(0))
      const decoded = new TextDecoder('utf-8').decode(bytes)
      return decoded.length > MAX_PREVIEW_LENGTH
        ? decoded.slice(0, MAX_PREVIEW_LENGTH) + '\n\n... (内容过长，已截断)'
        : decoded
    } catch {
      return '(无法解码文档内容)'
    }
  }
  return '(无内容)'
})

const hasPreview = computed(() => {
  if (props.text) return true
  if (props.data && isTextDocument.value) return true
  return false
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    previewOpen.value = false
  }
}

watch(previewOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>
