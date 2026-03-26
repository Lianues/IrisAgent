<template>
  <Transition name="queue-bar">
    <div v-if="queue.length > 0" class="message-queue-bar">
      <div class="queue-bar-header">
        <span class="queue-bar-title">
          <AppIcon :name="ICONS.common.schedule" class="queue-bar-icon" />
          {{ queue.length }} 条消息排队中
        </span>
        <button class="queue-bar-clear" type="button" @click="$emit('clear')">
          清空队列
        </button>
      </div>
      <div class="queue-bar-list">
        <div
          v-for="(msg, index) in queue"
          :key="msg.id"
          class="queue-bar-item"
          :class="{
            'drag-over-above': dropTarget === index && dropEdge === 'above',
            'drag-over-below': dropTarget === index && dropEdge === 'below',
            'dragging': dragIndex === index,
          }"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragend="onDragEnd"
          @dragover.prevent="onDragOver(index, $event)"
          @dragleave="onDragLeave(index)"
          @drop.prevent="onDrop(index)"
        >
          <span class="queue-bar-item-handle" title="拖拽排序">
            <AppIcon :name="ICONS.common.dragHandle" />
          </span>
          <span class="queue-bar-item-index">{{ index + 1 }}</span>
          <span class="queue-bar-item-text">{{ truncate(msg.text, 72) }}</span>
          <button
            class="queue-bar-item-remove"
            type="button"
            title="移除此消息"
            @click="$emit('remove', msg.id)"
          >
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { QueuedMessage } from '../composables/useMessageQueue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

defineProps<{ queue: QueuedMessage[] }>()
const emit = defineEmits<{
  remove: [id: string]
  clear: []
  reorder: [fromIndex: number, toIndex: number]
}>()

/** 正在拖拽的原始索引 */
const dragIndex = ref<number | null>(null)
/** 当前悬停的目标索引 */
const dropTarget = ref<number | null>(null)
/** 悬停在目标条目的上半/下半 */
const dropEdge = ref<'above' | 'below'>('below')

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // 必须设 data 否则 Firefox 不触发 drag
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragEnd() {
  dragIndex.value = null
  dropTarget.value = null
}

function onDragOver(index: number, event: DragEvent) {
  if (dragIndex.value === null || dragIndex.value === index) {
    dropTarget.value = null
    return
  }
  // 根据鼠标在条目内的纵向位置判断放置在上方还是下方
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  dropEdge.value = event.clientY < midY ? 'above' : 'below'
  dropTarget.value = index
}

function onDragLeave(index: number) {
  if (dropTarget.value === index) {
    dropTarget.value = null
  }
}

function onDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) return
  // 计算最终插入位置
  let toIndex = index
  if (dropEdge.value === 'below') {
    toIndex = index > dragIndex.value ? index : index + 1
  } else {
    toIndex = index < dragIndex.value ? index : index - 1
  }
  toIndex = Math.max(0, toIndex)
  emit('reorder', dragIndex.value, toIndex)
  dragIndex.value = null
  dropTarget.value = null
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\n/g, ' ↵ ').trim()
  return single.length <= max ? single : single.slice(0, max - 1) + '…'
}
</script>
