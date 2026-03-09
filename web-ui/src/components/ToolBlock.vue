<template>
  <div v-if="collapsed" class="tool-block collapsed" :class="type">
    <span class="tool-compact">
      <AppIcon :name="compactIconName" class="tool-compact-icon" />
      {{ name }}
    </span>
  </div>
  <div v-else class="tool-block" :class="[type, { open }]">
    <button
      class="tool-header"
      type="button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon :name="ICONS.common.chevronRight" class="tool-icon" />
      <div class="tool-header-main">
        <span class="tool-label">{{ type === 'call' ? '工具调用' : '工具结果' }}</span>
        <strong class="tool-name">{{ name }}</strong>
      </div>
      <span class="tool-state">{{ open ? '收起' : '展开' }}</span>
    </button>
    <div class="tool-body">{{ formatted }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const props = defineProps<{
  type: 'call' | 'response'
  name: string
  data: unknown
  collapsed?: boolean
}>()

const open = ref(false)
const compactIconName = computed(() => (props.type === 'call' ? ICONS.tool.call : ICONS.tool.response))
const formatted = computed(() => JSON.stringify(props.data ?? null, null, 2))
</script>
