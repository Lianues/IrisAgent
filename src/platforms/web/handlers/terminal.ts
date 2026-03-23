/**
 * 终端 WebSocket 处理器
 *
 * 通过 node-pty 在服务器端创建伪终端，
 * 经 WebSocket 与浏览器端 xterm.js 双向通信。
 */

import * as os from 'os';
import type { Duplex } from 'stream';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../../../logger';

const logger = createLogger('Terminal');

let pty: typeof import('node-pty') | null = null;
try {
  pty = await import('node-pty');
} catch {
  logger.warn('node-pty 不可用，终端功能将被禁用');
}

export interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  ws: WebSocket;
}

export interface TerminalHandler {
  /** 处理 HTTP upgrade 请求 */
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** 关闭所有终端会话 */
  killAll(): void;
  /** 终端功能是否可用 */
  available: boolean;
}

export function createTerminalHandler(): TerminalHandler {
  const sessions = new Map<string, TerminalSession>();
  const wss = new WebSocketServer({ noServer: true });
  let nextId = 1;

  function getShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  wss.on('connection', (ws: WebSocket) => {
    if (!pty) {
      ws.close(1011, 'node-pty 不可用');
      return;
    }

    const id = `term-${nextId++}`;
    const shell = getShell();

    let proc: import('node-pty').IPty;
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      logger.error(`PTY 创建失败: ${err}`);
      ws.close(1011, 'PTY 创建失败');
      return;
    }

    const session: TerminalSession = { id, pty: proc, ws };
    sessions.set(id, session);
    logger.info(`终端会话已创建: ${id} (shell=${shell}, pid=${proc.pid})`);

    // PTY 输出 → WebSocket
    proc.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    proc.onExit(({ exitCode }) => {
      logger.info(`终端进程退出: ${id} (code=${exitCode})`);
      if (ws.readyState === WebSocket.OPEN) {
        // 使用 \x00 前缀区分控制消息和终端数据，避免与正常输出混淆
        ws.send(`\x00${JSON.stringify({ type: 'exit', code: exitCode })}`);
        ws.close(1000, '终端进程已退出');
      }
      sessions.delete(id);
    });

    // WebSocket → PTY
    ws.on('message', (data: Buffer | string) => {
      const msg = typeof data === 'string' ? data : data.toString('utf8');

      // 尝试解析 JSON 控制消息
      if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
            proc.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
            return;
          }
        } catch {
          // 不是 JSON，作为普通输入
        }
      }

      proc.write(msg);
    });

    ws.on('close', () => {
      logger.info(`WebSocket 关闭，终止终端: ${id}`);
      try {
        proc.kill();
      } catch {
        // 进程可能已退出
      }
      sessions.delete(id);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket 错误 (${id}): ${err.message}`);
    });
  });

  return {
    available: pty !== null,

    handleUpgrade(req, socket, head) {
      if (!pty) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    },

    killAll() {
      for (const [id, session] of sessions) {
        logger.info(`关闭终端会话: ${id}`);
        try { session.pty.kill(); } catch { /* ignore */ }
        try { session.ws.close(1001, '服务器关闭'); } catch { /* ignore */ }
      }
      sessions.clear();
      wss.close();
    },
  };
}
