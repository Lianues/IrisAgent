/**
 * 轻量级 URL 路由器
 *
 * 支持路径参数（:id）、快捷方法（get/post/put/delete）、请求体解析。
 */

import * as http from 'http';

export type RouteParams = Record<string, string>;
export type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  /** 注册路由 */
  add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    // 将 :param 转换为命名捕获组
    const regexStr = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  get(path: string, handler: RouteHandler): void { this.add('GET', path, handler); }
  post(path: string, handler: RouteHandler): void { this.add('POST', path, handler); }
  put(path: string, handler: RouteHandler): void { this.add('PUT', path, handler); }
  delete(path: string, handler: RouteHandler): void { this.add('DELETE', path, handler); }

  /** 匹配并执行路由，返回是否匹配到 */
  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: RouteParams = {};
      try {
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
      } catch {
        // 畸形 URL 编码（如 %ZZ），返回原始值
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
      }

      await route.handler(req, res, params);
      return true;
    }
    return false;
  }
}

/**
 * 请求体大小上限（100MB）。
 * 单个 50MB 文档经 base64 编码后约为 67MB，需要更高上限。
 */
const MAX_BODY_SIZE = 100 * 1024 * 1024;

/** 读取请求体并解析为 JSON */
export function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求体 JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
export function sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
