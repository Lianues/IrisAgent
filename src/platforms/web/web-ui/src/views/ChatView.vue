<template>
  <main class="chat-area">
    <section class="chat-frame">
      <header class="chat-topbar">
        <div class="chat-topbar-main">
          <span class="chat-kicker">Iris Control Center</span>
          <h2>AI Agent 对话控制台</h2>
        </div>
        <p class="chat-topbar-note">支持流式推理、工具执行与多会话编排</p>
      </header>

      <MessageList
        :messages="messages"
        :messages-loading="messagesLoading"
        :messages-error="messagesError"
        :message-action-error="messageActionError"
        :sending="currentSessionSending"
        :streaming-text="streamingText"
        :is-streaming="isStreaming"
        :streaming-thought="streamingThought"
        :streaming-thought-duration-ms="streamingThoughtDurationMs"
        :actions-locked="sending"
        :armed-delete-message-index="armedDeleteMessageIndex"
        :deleting-message-index="deletingMessageIndex"
        @retry="retryLastMessage"
        @reload-history="reloadMessages"
        @clear-message-action-error="clearMessageActionError"
        @delete="deleteMessage"
      />
      <ChatInput :disabled="sending" @send="sendMessage" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { useChat } from '../composables/useChat'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'

const { messages, messagesLoading, messagesError, messageActionError, sending, streamingText, isStreaming, streamingThought, streamingThoughtDurationMs, armedDeleteMessageIndex, deletingMessageIndex, clearMessageActionError, currentSessionSending, sendMessage, retryLastMessage, deleteMessage, reloadMessages } = useChat()
</script>
