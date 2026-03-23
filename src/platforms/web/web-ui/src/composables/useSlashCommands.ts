/**
 * 斜杠命令注册与执行
 *
 * 提供命令匹配、自动补全列表和命令执行逻辑。
 */

import type { Ref } from 'vue'
import type { ChatDocumentAttachment, ChatImageAttachment, Message } from '../api/types'
import { showConfirm } from './useConfirmDialog'
import { useSessions } from './useSessions'
import { useAgents } from './useAgents'
import { requestOpenSettings } from './useAppActions'
import * as api from '../api/client'

export interface SlashCommand {
  name: string
  description: string
  usage: string
  hasArg: boolean
}

const commands: SlashCommand[] = [
  { name: '/new', description: '创建新会话', usage: '/new', hasArg: false },
  { name: '/load', description: '加载历史对话', usage: '/load [ID]', hasArg: true },
  { name: '/undo', description: '撤销上一条消息', usage: '/undo', hasArg: false },
  { name: '/redo', description: '重做上一条撤销', usage: '/redo', hasArg: false },
  { name: '/model', description: '切换模型', usage: '/model <name>', hasArg: true },
  { name: '/agent', description: '切换 Agent', usage: '/agent <name>', hasArg: true },
  { name: '/settings', description: '打开设置中心', usage: '/settings', hasArg: false },
  { name: '/mcp', description: '打开 MCP 管理', usage: '/mcp', hasArg: false },
  { name: '/sh', description: '执行 shell 命令', usage: '/sh <command>', hasArg: true },
  { name: '/reset-config', description: '重置配置为默认值', usage: '/reset-config', hasArg: false },
]

/** 返回匹配给定前缀的命令列表 */
function matchingCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return []
  const lower = input.toLowerCase().split(/\s/)[0]
  return commands.filter(cmd => cmd.name.startsWith(lower))
}

/** 判断是否为斜杠命令 */
function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/')
}

interface CommandContext {
  sendMessage: (text: string, images?: ChatImageAttachment[], documents?: ChatDocumentAttachment[]) => void
  undoLastMessage: () => Promise<void>
  redoLastMessage: () => Promise<void>
  currentSessionId: Ref<string | null>
  messages: Ref<Message[]>
}

function pushSystemMessage(ctx: CommandContext, text: string) {
  ctx.messages.value.push({ role: 'model', parts: [{ type: 'text', text }] })
}

async function executeCommand(text: string, ctx: CommandContext) {
  const trimmed = text.trim()
  const spaceIndex = trimmed.indexOf(' ')
  const cmd = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIndex).toLowerCase()
  const arg = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

  const { newChat, sessions, loadSessions, switchSession } = useSessions()

  switch (cmd) {
    case '/new':
      newChat()
      break

    case '/load': {
      await loadSessions()
      const list = sessions.value
      if (arg) {
        const target = list.find(s => s.id === arg)
        if (!target) {
          pushSystemMessage(ctx, `未找到 ID 为 "${arg}" 的对话。使用 \`/load\` 查看列表。`)
          return
        }
        switchSession(target.id)
        pushSystemMessage(ctx, `已加载对话: ${target.title || '(无标题)'}`)
        return
      }
      if (list.length === 0) {
        pushSystemMessage(ctx, '暂无历史对话。')
        return
      }
      const lines = list.slice(0, 20).map((s, i) => {
        const date = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''
        const title = s.title || '(无标题)'
        return `${i + 1}. **${title}**${date ? ` — ${date}` : ''}\n   ID: \`${s.id}\``
      })
      if (list.length > 20) lines.push(`...共 ${list.length} 条，仅显示最近 20 条`)
      pushSystemMessage(ctx, `历史对话列表：\n\n${lines.join('\n\n')}\n\n使用 \`/load <ID>\` 加载指定对话。`)
      return
    }

    case '/undo':
      await ctx.undoLastMessage()
      break

    case '/redo':
      await ctx.redoLastMessage()
      break

    case '/model':
      if (!arg) {
        pushSystemMessage(ctx, '用法: /model <模型名称>')
        return
      }
      try {
        const info = await api.switchModel(arg)
        pushSystemMessage(ctx, `模型已切换为: ${info.modelName ?? info.modelId}`)
      } catch (err) {
        pushSystemMessage(ctx, `切换模型失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      break

    case '/agent': {
      const { agents, multiAgentEnabled, currentAgent, switchAgent } = useAgents()
      if (!multiAgentEnabled.value) {
        pushSystemMessage(ctx, '多 Agent 模式未启用。请在配置文件中启用后重启。')
        return
      }
      if (!arg) {
        const list = agents.value.map(a => {
          const marker = a.name === currentAgent.value ? ' ← 当前' : ''
          const desc = a.description ? ` — ${a.description}` : ''
          return `- **${a.name}**${desc}${marker}`
        })
        pushSystemMessage(ctx, `可用 Agent：\n\n${list.join('\n')}\n\n使用 \`/agent <name>\` 切换。`)
        return
      }
      const target = agents.value.find(a => a.name === arg)
      if (!target) {
        pushSystemMessage(ctx, `未找到 Agent "${arg}"。可用: ${agents.value.map(a => a.name).join(', ')}`)
        return
      }
      switchAgent(arg)
      pushSystemMessage(ctx, `已切换到 Agent: ${arg}`)
      break
    }

    case '/settings':
      requestOpenSettings()
      break

    case '/mcp':
      requestOpenSettings('mcp')
      break

    case '/sh':
      if (!arg) {
        pushSystemMessage(ctx, '用法: /sh <命令>')
        return
      }
      try {
        const result = await api.runShellCommand(arg)
        pushSystemMessage(ctx, `\`\`\`\n$ ${arg}\n${result.output}\n\`\`\`\ncwd: ${result.cwd}`)
      } catch (err) {
        pushSystemMessage(ctx, `命令执行失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      break

    case '/reset-config': {
      const confirmed = await showConfirm({
        title: '确认重置配置',
        description: '此操作将把所有配置文件恢复为默认模板。<br>当前的 API 密钥、模型设置等将<strong>永久丢失</strong>，且无法撤销。',
        confirmText: '确认重置',
        danger: true,
      })
      if (!confirmed) return
      try {
        const result = await api.resetConfig()
        pushSystemMessage(ctx, result.success ? `配置已重置: ${result.message}` : `重置失败: ${result.message}`)
      } catch (err) {
        pushSystemMessage(ctx, `重置配置失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }

    default:
      pushSystemMessage(ctx, `未知命令: ${cmd}`)
  }
}

export function useSlashCommands() {
  return {
    commands,
    matchingCommands,
    isSlashCommand,
    executeCommand,
  }
}
