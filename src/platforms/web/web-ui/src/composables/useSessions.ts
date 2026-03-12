/**
 * 会话管理组合式函数
 *
 * 模块级响应式状态，所有组件共享同一份数据。
 */

import { ref } from 'vue'
import * as api from '../api/client'
import type { SessionSummary } from '../api/types'

/** 会话摘要列表 */
const sessions = ref<SessionSummary[]>([])

/** 当前选中的会话 */
const currentSessionId = ref<string | null>(null)

/** 是否正在加载会话列表 */
const sessionsLoading = ref(false)

/** 会话列表加载错误 */
const sessionsError = ref('')

export function useSessions() {
  async function loadSessions() {
    sessionsLoading.value = true
    sessionsError.value = ''
    try {
      const data = await api.getSessions()
      sessions.value = data.sessions || []
    } catch (err) {
      sessionsError.value = err instanceof Error ? err.message : '加载会话列表失败'
    } finally {
      sessionsLoading.value = false
    }
  }

  function newChat() {
    currentSessionId.value = null
  }

  function switchSession(id: string) {
    currentSessionId.value = id
  }

  async function removeSession(id: string) {
    await api.deleteSession(id)
    if (currentSessionId.value === id) {
      currentSessionId.value = null
    }
    await loadSessions()
  }

  return { sessions, currentSessionId, sessionsLoading, sessionsError, loadSessions, newChat, switchSession, removeSession }
}
