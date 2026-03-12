/**
 * 聊天逻辑组合式函数
 *
 * 管理消息列表、发送状态、流式输出状态。
 * 监听 currentSessionId 变化自动加载历史。
 */

import { ref, watch } from 'vue'
import { useSessions } from './useSessions'
import * as api from '../api/client'
import type { ImageInput, DocumentInput, Message, MessagePart } from '../api/types'

/** 当前会话的消息列表 */
const messages = ref<Message[]>([])

/** 是否正在发送 */
const sending = ref(false)

/** 流式输出累积文本 */
const streamingText = ref('')

/** 是否正在流式接收 */
const isStreaming = ref(false)

/** 当前请求的 AbortController，用于取消进行中的请求 */
let currentController: AbortController | null = null

/** 历史加载请求版本号，用于丢弃过期响应 */
let loadVersion = 0

/** 当前活动请求 token，用于丢弃已过期回调 */
let activeRequestToken: symbol | null = null

/** 当前活动请求归属的 sessionId（新会话会在 onSessionId 更新） */
let activeRequestSessionId: string | null = null

const { currentSessionId, loadSessions } = useSessions()

function normalizeImages(images?: ImageInput[]): ImageInput[] {
  return (images ?? []).map((image) => ({
    mimeType: image.mimeType,
    data: image.data,
  }))
}

function normalizeDocuments(documents?: DocumentInput[]): DocumentInput[] {
  return (documents ?? []).map((doc) => ({
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    data: doc.data,
  }))
}

function buildUserMessageParts(text: string, images?: ImageInput[], documents?: DocumentInput[]): MessagePart[] {
  const parts: MessagePart[] = []

  for (const image of normalizeImages(images)) {
    parts.push({
      type: 'image',
      mimeType: image.mimeType,
      data: image.data,
    })
  }

  for (const doc of normalizeDocuments(documents)) {
    parts.push({
      type: 'document',
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      data: doc.data,
    })
  }

  if (text.trim().length > 0) {
    parts.push({ type: 'text', text })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: '' })
  }

  return parts
}

/** 取消当前请求并失效对应回调 */
function abortCurrent() {
  if (currentController) {
    currentController.abort()
    currentController = null
  }
  activeRequestToken = null
  activeRequestSessionId = null
}

// 模块级 watch，生命周期与模块一致，不受组件卸载影响
watch(currentSessionId, async (id) => {
  // 由 onSessionId 触发的"新会话绑定"不应被视为切换会话
  const isInternalSessionBinding =
    currentController !== null && id !== null && id === activeRequestSessionId

  if (isInternalSessionBinding) {
    return
  }

  // 用户主动切换会话：中断进行中的请求并重置状态
  abortCurrent()
  streamingText.value = ''
  isStreaming.value = false
  sending.value = false

  const version = ++loadVersion
  if (id) {
    try {
      const data = await api.getMessages(id)
      // 请求期间会话又切换了，丢弃过期响应
      if (version !== loadVersion) return
      messages.value = data.messages || []
    } catch {
      if (version !== loadVersion) return
      messages.value = []
    }
  } else {
    messages.value = []
  }
})

export function useChat() {
  /** 提交流式文本到消息列表 */
  function flushStreaming() {
    if (streamingText.value) {
      messages.value.push({
        role: 'model',
        parts: [{ type: 'text', text: streamingText.value }],
      })
      streamingText.value = ''
    }
    isStreaming.value = false
  }

  async function sendMessage(text: string, images?: ImageInput[], documents?: DocumentInput[]) {
    const normalizedImages = normalizeImages(images)
    const normalizedDocs = normalizeDocuments(documents)
    if (sending.value || (!text.trim() && normalizedImages.length === 0 && normalizedDocs.length === 0)) return

    sending.value = true
    streamingText.value = ''
    isStreaming.value = false

    // 立即显示用户消息
    messages.value.push({
      role: 'user',
      parts: buildUserMessageParts(text, normalizedImages, normalizedDocs),
    })

    // 记录本次请求上下文，用于回调归属校验
    const requestToken = Symbol('chat-request')
    activeRequestToken = requestToken
    activeRequestSessionId = currentSessionId.value

    /** 检查回调是否仍属于当前活动请求 */
    const isStale = () => activeRequestToken !== requestToken

    currentController = api.sendChat(activeRequestSessionId, text, {
      onSessionId(id) {
        if (isStale()) return

        // 先更新请求归属，再更新 currentSessionId，避免 watch 误判为"切换会话"
        activeRequestSessionId = id
        if (currentSessionId.value !== id) {
          currentSessionId.value = id
        }
        loadSessions()
      },
      onDelta(delta) {
        if (isStale()) return
        if (!isStreaming.value) isStreaming.value = true
        streamingText.value += delta
      },
      onMessage(fullText) {
        if (isStale()) return
        messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: fullText }],
        })
      },
      onStreamEnd() {
        if (isStale()) return
        flushStreaming()
      },
      onDone() {
        if (isStale()) return
        flushStreaming()
        sending.value = false
        currentController = null
        activeRequestToken = null
        activeRequestSessionId = null
        loadSessions()
      },
      onError(msg) {
        if (isStale()) return
        flushStreaming()
        messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `错误: ${msg}` }],
        })
        sending.value = false
        currentController = null
        activeRequestToken = null
        activeRequestSessionId = null
      },
    }, normalizedImages, normalizedDocs)
  }

  /** 重试：截断后端历史，移除前端消息，重新发送 */
  async function retryLastMessage() {
    if (sending.value) return

    // 从后往前找最后一条用户消息
    let lastUserIdx = -1
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return

    const userMsg = messages.value[lastUserIdx]
    const text = userMsg.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    const images = userMsg.parts
      .filter((part): part is MessagePart & { type: 'image'; mimeType: string; data: string } => (
        part.type === 'image' && typeof part.mimeType === 'string' && typeof part.data === 'string'
      ))
      .map((part) => ({ mimeType: part.mimeType, data: part.data }))
    const documents = userMsg.parts
      .filter((part): part is MessagePart & { type: 'document'; mimeType: string; data: string } => (
        part.type === 'document' && typeof part.mimeType === 'string' && typeof part.data === 'string'
      ))
      .map((part) => ({ fileName: part.fileName ?? '', mimeType: part.mimeType, data: part.data }))

    if (!text.trim() && images.length === 0 && documents.length === 0) return

    // 提前置忙，防止异步截断期间重复触发
    sending.value = true

    // 先截断后端历史，确保前后端一致
    if (currentSessionId.value) {
      try {
        await api.truncateMessages(currentSessionId.value, lastUserIdx)
      } catch (e) {
        // 截断失败，提示用户并中止重试以保持前后端一致
        const detail = e instanceof Error ? e.message : String(e)
        messages.value.push({
          role: 'model',
          parts: [{ type: 'text', text: `重试失败: 无法截断历史记录 — ${detail}` }],
        })
        sending.value = false
        return
      }
    }

    // 移除该用户消息及之后的所有消息（本轮对话）
    messages.value.splice(lastUserIdx)

    // 解除忙状态后重新发送（sendMessage 内部会重新置 sending = true）
    sending.value = false
    void sendMessage(text, images, documents)
  }

  return { messages, sending, streamingText, isStreaming, sendMessage, retryLastMessage }
}
