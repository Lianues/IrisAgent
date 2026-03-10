/**
 * 会话管理组合式函数
 *
 * 模块级响应式状态，所有组件共享同一份数据。
 */

import { ref } from 'vue'
import * as api from '../api/client'

/** 会话 ID 列表 */
const sessions = ref<string[]>([])

/** 当前选中的会话 */
const currentSessionId = ref<string | null>(null)

export function useSessions() {
  async function loadSessions() {
    try {
      const data = await api.getSessions()
      sessions.value = data.sessions || []
    } catch { /* 静默 */ }
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

  return { sessions, currentSessionId, loadSessions, newChat, switchSession, removeSession }
}
