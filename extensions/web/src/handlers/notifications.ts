/**
 * 通知 WebSocket 处理器
 *
 * 提供持久化的 WebSocket 通道，用于向浏览器推送异步子代理任务通知
 * 和 notification turn 的流式事件（SSE 连接仅在 POST /api/chat 期间存在，
 * 空闲时无法推送）。
 */

import type { Duplex } from 'stream';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createExtensionLogger } from 'irises-extension-sdk';

const logger = createExtensionLogger('Notifications');

/** 客户端发送的控制消息 */
interface SubscribeMessage {
  type: 'subscribe';
  sessionIds: string[];
}

interface SubscribeAllMessage {
  type: 'subscribe_all';
}

type ClientMessage = SubscribeMessage | SubscribeAllMessage;

/** 单个 WebSocket 连接的状态 */
interface ClientState {
  ws: WebSocket;
  /** 订阅的 sessionId 集合；为 null 表示订阅全部 */
  sessionIds: Set<string> | null;
}

export interface NotificationHandler {
  /** 处理 HTTP upgrade 请求 */
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** 向订阅了指定 sessionId 的客户端推送事件 */
  pushEvent(sessionId: string, data: unknown): void;
  /** 向所有已连接客户端广播事件 */
  broadcastEvent(data: unknown): void;
  /** 关闭所有连接 */
  close(): void;
}

export function createNotificationHandler(): NotificationHandler {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientState>();

  wss.on('connection', (ws: WebSocket) => {
    const client: ClientState = { ws, sessionIds: null };
    clients.add(client);
    logger.info(`通知 WS 已连接 (当前 ${clients.size} 个客户端)`);

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg: ClientMessage = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
        if (msg.type === 'subscribe' && Array.isArray(msg.sessionIds)) {
          client.sessionIds = new Set(msg.sessionIds);
          logger.info(`WS 客户端订阅 ${msg.sessionIds.length} 个 session`);
        } else if (msg.type === 'subscribe_all') {
          client.sessionIds = null;
          logger.info('WS 客户端订阅全部 session');
        }
      } catch {
        // 忽略无法解析的消息
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      logger.info(`通知 WS 已断开 (剩余 ${clients.size} 个客户端)`);
    });

    ws.on('error', (err) => {
      logger.warn('通知 WS 错误:', err.message);
      clients.delete(client);
    });
  });

  function send(client: ClientState, data: unknown): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    },

    pushEvent(sessionId: string, data: unknown) {
      // 将 sessionId 注入载荷，使客户端能识别事件归属的会话
      const payload = typeof data === 'object' && data !== null
        ? { ...(data as Record<string, unknown>), sessionId }
        : { sessionId, data };
      for (const client of clients) {
        // sessionIds 为 null 表示订阅全部；否则检查是否包含目标 session
        if (client.sessionIds === null || client.sessionIds.has(sessionId)) {
          send(client, payload);
        }
      }
    },

    broadcastEvent(data: unknown) {
      for (const client of clients) {
        send(client, data);
      }
    },

    close() {
      for (const client of clients) {
        client.ws.close();
      }
      clients.clear();
      wss.close();
    },
  };
}
