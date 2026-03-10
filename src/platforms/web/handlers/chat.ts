/**
 * 聊天 API 处理器
 *
 * POST /api/chat — 通过 SSE 返回 AI 响应
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { readBody, sendJSON } from '../router';
import type { WebPlatform } from '../index';

export function createChatHandler(platform: WebPlatform) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body: any;
    try {
      body = await readBody(req);
    } catch {
      sendJSON(res, 400, { error: '请求体解析失败' });
      return;
    }

    const message = body.message?.trim();
    if (!message) {
      sendJSON(res, 400, { error: '消息不能为空' });
      return;
    }

    const sessionId = body.sessionId || `web-${crypto.randomUUID()}`;

    // 并发控制：同一 session 已有请求时拒绝
    if (platform.hasPending(sessionId)) {
      sendJSON(res, 409, { error: '该会话有正在处理的请求' });
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId,
    });
    res.flushHeaders();

    // 注册到 pending，等待 Orchestrator 处理
    platform.registerPending(sessionId, res);

    // 客户端断开时清理
    res.on('close', () => {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
    });

    // 启动心跳（工具调用可能耗时）
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15000);

    try {
      // 触发消息处理（Orchestrator 会通过 sendMessage/sendMessageStream 回调写入 SSE）
      await platform.dispatchMessage(sessionId, message);
      // 发送完成事件
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
      if (!res.writableEnded) res.end();
    }
  };
}
