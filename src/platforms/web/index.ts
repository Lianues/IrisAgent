/**
 * Web GUI 平台适配器
 *
 * 提供基于 SSE 的 HTTP API 和静态文件服务，
 * 实现浏览器端的 AI 聊天界面。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { PlatformAdapter } from '../base';
import { Router } from './router';
import { createChatHandler } from './handlers/chat';
import { createSessionsHandlers } from './handlers/sessions';
import { createConfigHandlers } from './handlers/config';
import { createDeployHandlers } from './handlers/deploy';
import { createCloudflareHandlers } from './handlers/cloudflare';
import { StorageProvider } from '../../storage/base';
import { ToolRegistry } from '../../tools/registry';
import { Orchestrator } from '../../core/orchestrator';
import { createLLMRouter } from '../../llm/factory';
import { parseTieredLLMConfig } from '../../config/llm';
import { parseMCPConfig } from '../../config/mcp';
import { DEFAULT_SYSTEM_PROMPT } from '../../prompt/templates/default';
import { createLogger } from '../../logger';
import { MCPManager, createMCPManager } from '../../mcp';
import { sendJSON } from './router';
import { CloudflareService } from './cloudflare/service';
import { assertManagementAccess, isManagementRoute } from './security/management';

const logger = createLogger('WebPlatform');

export interface WebPlatformConfig {
  port: number;
  host: string;
  authToken?: string;
  managementToken?: string;
  storage: StorageProvider;
  tools: ToolRegistry;
  configPath: string;
  llmName: string;
  modelName: string;
  streamEnabled: boolean;
}

/** MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export class WebPlatform extends PlatformAdapter {
  private server?: http.Server;
  private router: Router;
  private config: WebPlatformConfig;
  private publicDir: string;

  /** sessionId → 正在处理的 SSE 响应 */
  private pendingResponses = new Map<string, http.ServerResponse>();

  /** 协调器引用，供热重载使用 */
  private orchestrator?: Orchestrator;

  /** MCP 管理器引用，供热重载使用 */
  private mcpManager?: MCPManager;

  constructor(config: WebPlatformConfig) {
    super();
    this.config = config;
    this.router = new Router();
    // 静态文件目录：优先使用 Vue 构建产物（web-ui/dist），回退到旧的 public 目录
    // __dirname 在 dev(tsx) 时为 src/platforms/web，在 prod 时为 dist/platforms/web
    const projectRoot = path.resolve(__dirname, '../../..');
    const vueDist = path.join(projectRoot, 'web-ui/dist');
    const legacyPublic = path.join(__dirname, 'public');
    this.publicDir = fs.existsSync(vueDist) ? vueDist : legacyPublic;
    this.setupRoutes();
  }

  // ============ PlatformAdapter 接口 ============

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        // CORS 支持
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Management-Token, X-Deploy-Token');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url ?? '/';

        // 全局 API 路由认证：配置了 authToken 时校验 Bearer Token
        if (this.config.authToken && url.startsWith('/api/')) {
          const auth = req.headers.authorization ?? '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
          if (token !== this.config.authToken) {
            sendJSON(res, 401, { error: '未授权：缺少或无效的认证令牌' });
            return;
          }
        }

        // 管理面认证：仅对管理接口生效
        const pathname = new URL(url, `http://${req.headers.host ?? 'localhost'}`).pathname;
        if (isManagementRoute(pathname)) {
          if (!assertManagementAccess(req, res, this.config.managementToken)) {
            return;
          }
        }

        try {
          // 先匹配 API 路由
          const handled = await this.router.handle(req, res);
          if (!handled) {
            // 再尝试静态文件
            await this.serveStatic(req, res);
          }
        } catch (err: unknown) {
          logger.error('请求处理异常:', err);
          if (!res.headersSent) {
            sendJSON(res, 500, { error: '服务器内部错误' });
          }
        }
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(`Web GUI 已启动: http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // 关闭所有 pending SSE 连接
    for (const [, res] of this.pendingResponses) {
      if (!res.writableEnded) res.end();
    }
    this.pendingResponses.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /** 非流式：向 SSE 连接写入完整消息 */
  async sendMessage(sessionId: string, text: string): Promise<void> {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ type: 'message', text })}\n\n`);
  }

  /** 流式：逐 chunk 写入 SSE */
  async sendMessageStream(sessionId: string, stream: AsyncIterable<string>): Promise<void> {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded) return;

    for await (const chunk of stream) {
      if (res.writableEnded) break;
      res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk })}\n\n`);
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'stream_end' })}\n\n`);
    }
  }

  // ============ 供 chat handler 调用的方法 ============

  /** 检查是否有正在处理的请求 */
  hasPending(sessionId: string): boolean {
    return this.pendingResponses.has(sessionId);
  }

  /** 注册 pending SSE 响应 */
  registerPending(sessionId: string, res: http.ServerResponse): void {
    this.pendingResponses.set(sessionId, res);
  }

  /** 移除 pending SSE 响应 */
  removePending(sessionId: string): void {
    this.pendingResponses.delete(sessionId);
  }

  /** 分发用户消息到 Orchestrator */
  async dispatchMessage(sessionId: string, message: string): Promise<void> {
    if (!this.messageHandler) throw new Error('消息处理器未注册');
    await this.messageHandler({
      sessionId,
      parts: [{ text: message }],
    });
  }

  /** 注入 Orchestrator 引用（启动后调用） */
  setOrchestrator(orch: Orchestrator): void {
    this.orchestrator = orch;
  }

  /** 注入 MCP 管理器引用（供热重载和退出清理使用） */
  setMCPManager(mgr: MCPManager): void {
    this.mcpManager = mgr;
  }

  /** 获取当前 MCP 管理器（热重载后可能已替换） */
  getMCPManager(): MCPManager | undefined {
    return this.mcpManager;
  }

  // ============ 内部方法 ============

  private setupRoutes(): void {
    const { storage, tools, configPath } = this.config;
    const cloudflareService = new CloudflareService(configPath);

    // 聊天 API
    this.router.post('/api/chat', createChatHandler(this));

    // 会话管理 API
    const sessions = createSessionsHandlers(storage);
    this.router.get('/api/sessions', sessions.list);
    this.router.get('/api/sessions/:id/messages', sessions.getMessages);
    this.router.delete('/api/sessions/:id/messages', sessions.truncateMessages);
    this.router.delete('/api/sessions/:id', sessions.remove);

    // 配置管理 API（带热重载回调）
    const config = createConfigHandlers(configPath, async (mergedConfig) => {
      if (!this.orchestrator) throw new Error('Orchestrator 未注入');
      // 重建 LLM 路由器（三层）
      const tieredConfig = parseTieredLLMConfig(mergedConfig.llm);
      const newRouter = createLLMRouter(tieredConfig);
      this.orchestrator.reloadLLM(newRouter);
      // 更新运行时参数
      this.orchestrator.reloadConfig({
        stream: mergedConfig.system?.stream,
        maxToolRounds: mergedConfig.system?.maxToolRounds,
        systemPrompt: mergedConfig.system?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      });
      // 更新本地状态信息（供 /api/status 使用）
      this.config.llmName = tieredConfig.primary.provider ?? this.config.llmName;
      this.config.modelName = tieredConfig.primary.model ?? this.config.modelName;
      this.config.streamEnabled = mergedConfig.system?.stream ?? this.config.streamEnabled;

      // MCP 热重载（先完成 reload，再卸载旧工具，防止 reload 失败导致工具丢失）
      const newMcpConfig = parseMCPConfig(mergedConfig.mcp);
      const unregisterOldMcpTools = () => {
        for (const name of tools.listTools()) {
          if (name.startsWith('mcp__')) tools.unregister(name);
        }
      };
      if (this.mcpManager) {
        if (newMcpConfig) {
          await this.mcpManager.reload(newMcpConfig);
          unregisterOldMcpTools();
          tools.registerAll(this.mcpManager.getTools());
        } else {
          await this.mcpManager.disconnectAll();
          unregisterOldMcpTools();
          this.mcpManager = undefined;
        }
      } else if (newMcpConfig) {
        this.mcpManager = createMCPManager(newMcpConfig);
        await this.mcpManager.connectAll();
        unregisterOldMcpTools();
        tools.registerAll(this.mcpManager.getTools());
      }
    });
    this.router.get('/api/config', config.get);
    this.router.put('/api/config', config.update);

    // 状态 API（动态读取，热重载后返回最新值）
    this.router.get('/api/status', async (_req, res) => {
      sendJSON(res, 200, {
        provider: this.config.llmName,
        model: this.config.modelName,
        tools: tools.getDeclarations().map(d => d.name),
        stream: this.config.streamEnabled,
        platform: 'web',
      });
    });

    // 部署管理 API
    const deploy = createDeployHandlers({
      host: this.config.host,
      port: this.config.port,
      getCloudflareDeployContext: (domain?: string | null) => cloudflareService.getDeployContext(domain),
      setCloudflareSslMode: (mode, zoneId) => cloudflareService.setSsl(mode, zoneId),
    });
    this.router.get('/api/deploy/state', deploy.state);
    this.router.get('/api/deploy/detect', deploy.detect);
    this.router.post('/api/deploy/preview', deploy.preview);
    this.router.post('/api/deploy/sync-cloudflare', deploy.syncCloudflare);
    this.router.post('/api/deploy/nginx', deploy.nginx);
    this.router.post('/api/deploy/service', deploy.service);

    // Cloudflare 管理 API
    const cf = createCloudflareHandlers(cloudflareService);
    this.router.get('/api/cloudflare/status', cf.status);
    this.router.get('/api/cloudflare/dns', cf.listDns);
    this.router.post('/api/cloudflare/dns', cf.addDns);
    this.router.delete('/api/cloudflare/dns/:id', cf.removeDns);
    this.router.get('/api/cloudflare/ssl', cf.getSsl);
    this.router.put('/api/cloudflare/ssl', cf.setSsl);
    this.router.post('/api/cloudflare/setup', cf.setup);
  }

  /** 静态文件服务 */
  private async serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = url.pathname;

    // 根路径 → index.html
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    // 安全检查：防止路径穿越（resolve + relative 在 Windows 上也安全）
    const filePath = path.resolve(this.publicDir, pathname.slice(1));
    const relative = path.relative(this.publicDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      sendJSON(res, 403, { error: '禁止访问' });
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new Error('非文件');

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      // SPA 回退：非静态资源路由一律返回 index.html（支持 Vue Router history 模式）
      const indexPath = path.join(this.publicDir, 'index.html');
      try {
        const indexStat = await fs.promises.stat(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': indexStat.size });
        fs.createReadStream(indexPath).pipe(res);
      } catch {
        sendJSON(res, 404, { error: '未找到资源' });
      }
    }
  }
}
