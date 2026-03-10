/**
 * Cloudflare 管理 API 处理器
 *
 * GET  /api/cloudflare/status    — 获取连接状态和 zone 列表
 * GET  /api/cloudflare/dns       — 列出 DNS 记录
 * POST /api/cloudflare/dns       — 添加 DNS 记录
 * DELETE /api/cloudflare/dns/:id — 删除 DNS 记录
 * GET  /api/cloudflare/ssl       — 获取 SSL 模式
 * PUT  /api/cloudflare/ssl       — 切换 SSL 模式
 * POST /api/cloudflare/setup     — 首次配置（验证 token 并写入 config）
 */

import * as http from 'http';
import { readBody, sendJSON, RouteParams } from '../router';
import { CloudflareService } from '../cloudflare/service';

/** 从请求 URL 中提取 query 参数 */
function getQueryParam(req: http.IncomingMessage, name: string): string | null {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams.get(name);
}

/** 根据错误信息推断 HTTP 状态码 */
function statusCodeFromError(message: string): number {
  if (
    message.startsWith('请提供 API Token')
    || message.startsWith('Token 验证失败')
    || message.startsWith('缺少必填字段')
    || message.startsWith('缺少记录 ID')
    || message.startsWith('无效的 SSL 模式')
    || message.startsWith('未配置 Cloudflare')
    || message.includes('多个 zone')
  ) {
    return 400;
  }
  return 500;
}

/** Cloudflare handler 工厂 */
export function createCloudflareHandlers(service: CloudflareService) {
  return {
    /** GET /api/cloudflare/status */
    async status(_req: http.IncomingMessage, res: http.ServerResponse) {
      const status = await service.getStatus();
      sendJSON(res, 200, status);
    },

    /** GET /api/cloudflare/dns */
    async listDns(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const zoneId = getQueryParam(req, 'zoneId');
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const page = url.searchParams.get('page') || '1';
        const perPage = url.searchParams.get('per_page') || '50';
        const records = await service.listDns(zoneId, page, perPage);
        sendJSON(res, 200, { records });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { error: msg });
      }
    },

    /** POST /api/cloudflare/dns */
    async addDns(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req);
        const record = await service.addDns(body ?? {});
        sendJSON(res, 200, { ok: true, record });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { error: msg });
      }
    },

    /** DELETE /api/cloudflare/dns/:id */
    async removeDns(req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      try {
        const recordId = params.id;
        const zoneId = getQueryParam(req, 'zoneId');
        await service.removeDns(recordId, zoneId);
        sendJSON(res, 200, { ok: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { error: msg });
      }
    },

    /** GET /api/cloudflare/ssl */
    async getSsl(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const zoneId = getQueryParam(req, 'zoneId');
        const mode = await service.getSsl(zoneId);
        sendJSON(res, 200, { mode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { error: msg });
      }
    },

    /** PUT /api/cloudflare/ssl */
    async setSsl(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req);
        const mode = await service.setSsl(body?.mode, body?.zoneId);
        sendJSON(res, 200, { ok: true, mode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { error: msg });
      }
    },

    /** POST /api/cloudflare/setup */
    async setup(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req);
        const result = await service.setupInlineToken(body?.apiToken);
        sendJSON(res, 200, { ok: true, zones: result.zones });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromError(msg), { ok: false, error: msg });
      }
    },
  };
}
