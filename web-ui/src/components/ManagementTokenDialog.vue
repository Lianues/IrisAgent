<template>
  <Transition name="panel-modal">
    <div class="overlay" @click.self="emit('close')">
      <div class="settings-panel" style="max-width:560px;width:min(92vw,560px)">
        <div class="settings-header">
          <div class="settings-title-group">
            <span class="settings-kicker">Management Access</span>
            <h2>管理令牌</h2>
            <p>用于访问配置、部署、Cloudflare 等管理接口。令牌仅保存在当前浏览器本地。</p>
          </div>
          <button class="btn-close" type="button" aria-label="关闭" @click="emit('close')">
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>

        <div class="settings-body">
          <div class="form-group">
            <label>当前状态</label>
            <p class="field-hint" style="margin-top:4px">
              <strong :style="{ color: hasToken ? 'var(--success)' : 'var(--error)' }">
                {{ hasToken ? '已保存管理令牌' : '未保存管理令牌' }}
              </strong>
            </p>
          </div>

          <div class="form-group">
            <label>管理令牌（X-Management-Token）</label>
            <input
              type="password"
              v-model="tokenInput"
              placeholder="请输入平台配置中的 managementToken"
              @keydown.enter="save"
            />
            <p class="field-hint">保存后会自动附加到管理接口请求头。</p>
          </div>

          <div class="form-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button class="btn-save" type="button" @click="save">保存令牌</button>
            <button class="btn-cancel" type="button" @click="clear" style="padding:8px 14px">清除令牌</button>
            <span v-if="statusText" class="settings-status" :class="{ error: statusError }">{{ statusText }}</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import {
  clearManagementToken,
  loadManagementToken,
  saveManagementToken,
  subscribeManagementTokenChange,
} from '../utils/managementToken'

const emit = defineEmits<{
  close: []
  updated: []
}>()

const tokenInput = ref('')
const statusText = ref('')
const statusError = ref(false)
const hasToken = ref(false)

let unsubscribe: (() => void) | null = null

function refreshTokenState() {
  hasToken.value = !!loadManagementToken().trim()
}

function save() {
  const token = tokenInput.value.trim()
  if (!token) {
    statusText.value = '请输入令牌'
    statusError.value = true
    return
  }
  saveManagementToken(token)
  tokenInput.value = ''
  refreshTokenState()
  statusText.value = '已保存'
  statusError.value = false
  emit('updated')
}

function clear() {
  clearManagementToken()
  tokenInput.value = ''
  refreshTokenState()
  statusText.value = '已清除'
  statusError.value = false
  emit('updated')
}

onMounted(() => {
  refreshTokenState()
  unsubscribe = subscribeManagementTokenChange(refreshTokenState)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
