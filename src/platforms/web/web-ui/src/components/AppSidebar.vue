<template>
  <aside class="sidebar" :class="{ open: mobileOpen }">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="sidebar-badge">Control Hub</span>
        <div class="logo">Iris</div>
        <p class="sidebar-subtitle">集中管理会话、部署与系统配置。</p>
      </div>

      <button class="btn-new-chat" type="button" @click="handleNewChat">
        <span class="btn-new-icon"><AppIcon :name="ICONS.common.add" /></span>
        <span>新建会话</span>
      </button>
    </div>

    <nav class="sidebar-nav">
      <RouterLink class="sidebar-nav-link" to="/" @click="emit('toggle')">
        <span class="sidebar-nav-icon"><AppIcon :name="ICONS.sidebar.chat" /></span>
        <span class="sidebar-nav-copy">
          <span class="sidebar-nav-label">Workspace</span>
          <strong>聊天控制台</strong>
        </span>
      </RouterLink>

      <RouterLink class="sidebar-nav-link" to="/deploy" @click="emit('toggle')">
        <span class="sidebar-nav-icon"><AppIcon :name="ICONS.sidebar.deploy" /></span>
        <span class="sidebar-nav-copy">
          <span class="sidebar-nav-label">Delivery</span>
          <strong>部署生成器</strong>
        </span>
      </RouterLink>
    </nav>

    <div class="sidebar-route-context">
      <div class="session-list" v-if="route.path === '/'">
        <div class="sidebar-section-label">会话列表</div>

        <div class="sidebar-empty" v-if="sessions.length === 0">
          <span class="sidebar-empty-icon"><AppIcon :name="ICONS.sidebar.empty" /></span>
          <p>暂无会话</p>
          <span>点击“新建会话”开始第一次对话。</span>
        </div>

        <div class="session-items" v-else>
          <div
            class="session-item"
            :class="{ active: id === currentSessionId }"
            v-for="id in sessions"
            :key="id"
          >
            <button class="session-button" type="button" @click="handleSwitchSession(id)">
              <span class="session-caption">Session</span>
              <span class="session-name">{{ id }}</span>
            </button>
            <button
              class="btn-delete-session"
              type="button"
              title="删除会话"
              :disabled="deletingSessionId === id"
              @click.stop="handleDeleteSession(id)"
            >
              <AppIcon :name="ICONS.common.close" />
            </button>
          </div>
        </div>
      </div>

      <div class="sidebar-context-card" v-else>
        <span class="sidebar-context-kicker">Deploy Focus</span>
        <h3>发布前检查</h3>
        <ul class="sidebar-context-list">
          <li>确认域名解析到当前服务器</li>
          <li>检查 Nginx 与 systemd 环境检测状态</li>
          <li>按需配置 Cloudflare DNS 与 SSL 模式</li>
        </ul>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="status-card">
        <span class="status-dot" :style="{ background: managementReady ? 'var(--success)' : 'var(--error)' }"></span>
        <div class="status-copy">
          <span class="status-label">管理令牌</span>
          <span class="status-value">{{ managementReady ? '已解锁管理接口' : '未设置，管理接口可能返回 401' }}</span>
        </div>
      </div>

      <button class="btn-settings" type="button" @click="handleOpenManagementToken">
        <AppIcon :name="ICONS.sidebar.key" />
        <span>管理令牌</span>
      </button>

      <button class="btn-settings" type="button" @click="handleOpenSettings">
        <AppIcon :name="ICONS.common.settings" />
        <span>设置中心</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useSessions } from '../composables/useSessions'
import { loadManagementToken, subscribeManagementTokenChange } from '../utils/managementToken'

const props = defineProps<{
  mobileOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'open-settings'): void
  (e: 'open-management-token'): void
}>()

const route = useRoute()
const router = useRouter()
const { sessions, currentSessionId, loadSessions, newChat, switchSession, removeSession } = useSessions()

const deletingSessionId = ref<string | null>(null)
const managementReady = ref(false)

let unsubscribeManagementToken: (() => void) | null = null

function refreshManagementState() {
  managementReady.value = !!loadManagementToken().trim()
}

async function handleNewChat() {
  if (route.path !== '/') await router.push('/')
  newChat()
  emit('toggle')
}

async function handleSwitchSession(id: string) {
  if (route.path !== '/') await router.push('/')
  switchSession(id)
  emit('toggle')
}

async function handleDeleteSession(id: string) {
  if (deletingSessionId.value) return
  deletingSessionId.value = id
  try {
    await removeSession(id)
  } finally {
    deletingSessionId.value = null
  }
}

function handleOpenSettings() {
  emit('open-settings')
  emit('toggle')
}

function handleOpenManagementToken() {
  emit('open-management-token')
  emit('toggle')
}

onMounted(async () => {
  await loadSessions()
  refreshManagementState()
  unsubscribeManagementToken = subscribeManagementTokenChange(refreshManagementState)
})

onUnmounted(() => {
  unsubscribeManagementToken?.()
})

watch(() => route.fullPath, async () => {
  await loadSessions()
  refreshManagementState()
})

watch(() => props.mobileOpen, () => {
  refreshManagementState()
})
</script>
