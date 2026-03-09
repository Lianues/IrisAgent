<template>
  <aside class="sidebar" :class="{ open: mobileOpen }">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="sidebar-badge">Control Center</span>
        <h1 class="logo">IrisClaw</h1>
        <p class="sidebar-subtitle">AI Agent Registry · 对话与部署一体化控制台</p>
      </div>

      <button class="btn-new-chat" type="button" @click="handleNewChat">
        <AppIcon :name="ICONS.common.add" class="btn-new-icon" />
        <span>新建对话</span>
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="主导航">
      <RouterLink class="sidebar-nav-link" to="/" @click="emit('toggle')">
        <AppIcon :name="ICONS.sidebar.chat" class="sidebar-nav-icon" />
        <div class="sidebar-nav-copy">
          <span class="sidebar-nav-label">对话工作台</span>
          <strong>Chat Workspace</strong>
        </div>
      </RouterLink>

      <RouterLink class="sidebar-nav-link" to="/deploy" @click="emit('toggle')">
        <AppIcon :name="ICONS.sidebar.deploy" class="sidebar-nav-icon" />
        <div class="sidebar-nav-copy">
          <span class="sidebar-nav-label">部署生成器</span>
          <strong>Deploy Studio</strong>
        </div>
      </RouterLink>
    </nav>

    <template v-if="isChatRoute">
      <div class="sidebar-section-label">最近会话</div>

      <div class="session-list">
        <div v-if="sessions.length === 0" class="sidebar-empty">
          <AppIcon :name="ICONS.sidebar.empty" class="sidebar-empty-icon" />
          <p>还没有历史对话</p>
          <span>点击“新建对话”开始一个全新的工作流。</span>
        </div>

        <div v-else class="session-items">
          <div
            v-for="(id, index) in sessions"
            :key="id"
            class="session-item"
            :class="{ active: id === currentSessionId }"
          >
            <button
              class="session-button"
              type="button"
              :title="id"
              @click="handleSwitch(id)"
            >
              <span class="session-caption">
                {{ id === currentSessionId ? '当前会话' : `对话 ${index + 1}` }}
              </span>
              <span class="session-name">{{ displayName(id) }}</span>
            </button>
            <button
              class="btn-delete-session"
              type="button"
              aria-label="删除会话"
              @click.stop="handleDelete(id)"
            >
              <AppIcon :name="ICONS.common.close" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="sidebar-section-label">部署向导</div>
      <div class="sidebar-route-context">
        <div class="sidebar-context-card">
          <span class="sidebar-context-kicker">Checklist</span>
          <h3>本机部署建议流程</h3>
          <ol class="sidebar-context-list">
            <li>确认当前机器是 Linux 且支持 sudo。</li>
            <li>填写域名、端口、部署路径与运行用户。</li>
            <li>下载配置或执行一键部署。</li>
            <li>开放防火墙 80/443 端口。</li>
            <li>在「设置中心」连接 Cloudflare 并添加 DNS 记录。</li>
          </ol>
        </div>
      </div>
    </template>

    <div class="sidebar-footer">
      <div class="status-card">
        <span class="status-dot"></span>
        <div class="status-copy">
          <span class="status-label">当前模型</span>
          <strong class="status-value">{{ statusText || '正在读取系统状态...' }}</strong>
        </div>
      </div>

      <button class="btn-settings" type="button" @click="emit('open-settings')">
        <AppIcon :name="ICONS.common.settings" />
        <span>设置中心</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useSessions } from '../composables/useSessions'
import { getStatus } from '../api/client'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

defineProps<{ mobileOpen: boolean }>()
const emit = defineEmits<{
  toggle: []
  'open-settings': []
}>()

const route = useRoute()
const router = useRouter()
const { sessions, currentSessionId, loadSessions, newChat, switchSession, removeSession } = useSessions()
const statusText = ref('')

const isChatRoute = computed(() => route.path === '/')

function displayName(id: string) {
  return id.length > 30 ? id.slice(0, 30) + '...' : id
}

async function handleNewChat() {
  newChat()
  if (!isChatRoute.value) {
    await router.push('/')
  }
  emit('toggle')
}

async function handleSwitch(id: string) {
  switchSession(id)
  if (!isChatRoute.value) {
    await router.push('/')
  }
  emit('toggle')
}

async function handleDelete(id: string) {
  await removeSession(id)
}

onMounted(async () => {
  await loadSessions()
  try {
    const status = await getStatus()
    statusText.value = `${status.provider} / ${status.model}`
  } catch {
    statusText.value = ''
  }
})
</script>
