/**
 * 会话管理 API 处理器
 *
 * GET    /api/sessions                       — 列出所有会话
 * GET    /api/sessions/:id/messages          — 获取会话历史
 * DELETE /api/sessions/:id                   — 清除会话历史
 * DELETE /api/sessions/:id/messages?keepCount=N — 截断会话历史
 */

import * as http from 'http';
import { RouteParams, sendJSON } from '../router';
import { StorageProvider } from '../../../storage/base';
import { isOCRTextPart } from '../../../ocr';
import { Content, isTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart } from '../../../types';
import { isDocumentMimeType } from '../../../llm/vision';

/** 将 Content[] 转换为前端友好格式 */
function formatMessages(contents: Content[]) {
  return contents.map(c => {
    const formatted: any = { role: c.role, parts: [] };
    for (const part of c.parts) {
      if (isOCRTextPart(part)) {
        continue;
      }

      if (isTextPart(part)) {
        formatted.parts.push({ type: 'text', text: part.text });
        continue;
      }

      if (isInlineDataPart(part)) {
        if (isDocumentMimeType(part.inlineData.mimeType)) {
          formatted.parts.push({
            type: 'document',
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
          });
        } else {
          formatted.parts.push({
            type: 'image',
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
          });
        }
        continue;
      }

      if (isFunctionCallPart(part)) {
        formatted.parts.push({
          type: 'function_call',
          name: part.functionCall.name,
          args: part.functionCall.args,
        });
        continue;
      }

      if (isFunctionResponsePart(part)) {
        formatted.parts.push({
          type: 'function_response',
          name: part.functionResponse.name,
          response: part.functionResponse.response,
        });
      }
    }
    return formatted;
  });
}

export function createSessionsHandlers(storage: StorageProvider) {
  return {
    /** GET /api/sessions */
    async list(_req: http.IncomingMessage, res: http.ServerResponse) {
      const sessions = await storage.listSessions();
      sendJSON(res, 200, { sessions });
    },

    /** GET /api/sessions/:id/messages */
    async getMessages(_req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      const history = await storage.getHistory(params.id);
      sendJSON(res, 200, { messages: formatMessages(history) });
    },

    /** DELETE /api/sessions/:id */
    async remove(_req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      await storage.clearHistory(params.id);
      sendJSON(res, 200, { ok: true });
    },

    /** DELETE /api/sessions/:id/messages?keepCount=N */
    async truncateMessages(req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const keepCount = parseInt(url.searchParams.get('keepCount') ?? '', 10);
      if (isNaN(keepCount) || keepCount < 0) {
        sendJSON(res, 400, { error: '参数 keepCount 无效' });
        return;
      }
      await storage.truncateHistory(params.id, keepCount);
      sendJSON(res, 200, { ok: true });
    },
  };
}
