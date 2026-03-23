/**
 * 终端连接组合式函数
 *
 * 管理 xterm.js 终端实例和 WebSocket 连接。
 * 支持自动重连、resize、主题跟随。
 */

import { ref, watch, onUnmounted, onActivated, onDeactivated } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from './useTheme'
import { loadAuthToken } from '../utils/authToken'

function getThemeColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return {
    bgCanvas: style.getPropertyValue('--bg-canvas').trim(),
    textPrimary: style.getPropertyValue('--text-primary').trim(),
    textSecondary: style.getPropertyValue('--text-secondary').trim(),
    textMuted: style.getPropertyValue('--text-muted').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    accentCyan: style.getPropertyValue('--accent-cyan').trim(),
    success: style.getPropertyValue('--success').trim(),
    error: style.getPropertyValue('--error').trim(),
  }
}

function buildXtermTheme(colors: Record<string, string>) {
  return {
    background: colors.bgCanvas || '#090b16',
    foreground: colors.textPrimary || '#f5f7ff',
    cursor: colors.accent || '#8b7cff',
    cursorAccent: colors.bgCanvas || '#090b16',
    selectionBackground: (colors.accent || '#8b7cff') + '40',
    selectionForeground: colors.textPrimary || '#f5f7ff',
    black: '#1a1d2e',
    red: colors.error || '#ff7c7c',
    green: colors.success || '#59d69a',
    yellow: '#fdcb6e',
    blue: colors.accent || '#8b7cff',
    magenta: '#a78bfa',
    cyan: colors.accentCyan || '#74d7ff',
    white: colors.textPrimary || '#f5f7ff',
    brightBlack: colors.textMuted || '#727ca1',
    brightRed: '#ff9b9b',
    brightGreen: '#7ee6b8',
    brightYellow: '#ffe08a',
    brightBlue: '#a99bff',
    brightMagenta: '#c4a8ff',
    brightCyan: '#9ae3ff',
    brightWhite: '#ffffff',
  }
}

export function useTerminal() {
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref('')

  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null
  let container: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const { resolvedTheme } = useTheme()

  function buildWsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${proto}//${location.host}/ws/terminal`)
    const token = loadAuthToken()
    if (token) {
      url.searchParams.set('token', token)
    }
    return url.toString()
  }

  function updateTheme() {
    if (!terminal) return
    const colors = getThemeColors()
    terminal.options.theme = buildXtermTheme(colors)
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    // 清理旧 WebSocket 的事件处理器，防止 CLOSING 状态的旧连接触发重连
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws = null
    }

    error.value = ''
    connecting.value = true
    const url = buildWsUrl()

    try {
      ws = new WebSocket(url)
    } catch (err) {
      connecting.value = false
      error.value = `WebSocket 连接失败: ${err instanceof Error ? err.message : '未知错误'}`
      return
    }

    ws.onopen = () => {
      connected.value = true
      connecting.value = false
      error.value = ''
      // 连接建立后立即同步终端尺寸
      if (terminal && fitAddon) {
        fitAddon.fit()
      }
    }

    ws.onmessage = (event) => {
      if (!terminal || typeof event.data !== 'string') return

      // 服务端控制消息以 \x00 前缀区分，避免与终端输出混淆
      if (event.data.charCodeAt(0) === 0) {
        try {
          const parsed = JSON.parse(event.data.slice(1))
          if (parsed.type === 'exit') {
            error.value = `终端进程已退出 (code=${parsed.code})`
            connected.value = false
            return
          }
        } catch { /* 忽略无法解析的控制消息 */ }
        return
      }

      terminal.write(event.data)
    }

    ws.onclose = () => {
      connected.value = false
      // 非主动关闭时尝试重连
      if (container) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      error.value = '连接中断'
      connected.value = false
      connecting.value = false
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (container) {
        connectWs()
      }
    }, 3000)
  }

  function attach(el: HTMLElement) {
    container = el
    const colors = getThemeColors()

    terminal = new Terminal({
      theme: buildXtermTheme(colors),
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.35,
      cursorStyle: 'bar',
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(el)

    // 首次 fit
    requestAnimationFrame(() => {
      fitAddon?.fit()
    })

    // 终端输入 → WebSocket
    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    // 终端 resize → WebSocket
    terminal.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // 容器尺寸变化自动 fit
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon?.fit()
      })
    })
    resizeObserver.observe(el)

    // 建立 WebSocket 连接
    connectWs()
  }

  function detach() {
    container = null

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }

    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
      ws = null
    }

    if (terminal) {
      terminal.dispose()
      terminal = null
    }

    fitAddon = null
    connected.value = false
    connecting.value = false
    error.value = ''
  }

  function reconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
      ws = null
    }

    connected.value = false
    connecting.value = false
    error.value = ''

    if (terminal) {
      terminal.clear()
    }

    connectWs()
  }

  // 主题切换时更新终端颜色
  watch(resolvedTheme, () => {
    // 延迟一帧让 CSS 变量生效
    requestAnimationFrame(updateTheme)
  })

  // KeepAlive 激活 — 恢复 resize 监听并 refit
  onActivated(() => {
    if (terminal && fitAddon && container) {
      // 恢复 resize 观察
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => fitAddon?.fit())
        })
        resizeObserver.observe(container)
      }
      // 重新 fit（容器尺寸可能在去激活期间变化）
      requestAnimationFrame(() => {
        fitAddon?.fit()
        terminal?.focus()
      })
    }
  })

  // KeepAlive 去激活 — 暂停 resize 监听，保持 WebSocket 连接
  onDeactivated(() => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  })

  onUnmounted(detach)

  return {
    connected,
    connecting,
    error,
    attach,
    detach,
    reconnect,
  }
}
