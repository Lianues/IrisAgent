/**
 * MCP 客户端
 *
 * 封装 MCP SDK Client，管理单个 MCP 服务器的连接、工具列表和工具调用。
 * SDK 为 ESM-only，通过动态 import() 加载。
 */

import { MCPServerConfig } from '../config/types';
import { MCPClientStatus } from './types';
import { createLogger } from '../logger';

const logger = createLogger('MCPClient');

/** SDK Tool 类型（避免静态 import ESM） */
interface SDKTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/** SDK callTool 结果中的内容块 */
interface SDKContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export class MCPClient {
  readonly serverName: string;
  private config: MCPServerConfig;
  private _status: MCPClientStatus = 'disconnected';
  private _error?: string;
  private _tools: SDKTool[] = [];
  private client: any = null;
  private transport: any = null;

  constructor(serverName: string, config: MCPServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  get status(): MCPClientStatus { return this._status; }
  get error(): string | undefined { return this._error; }
  get toolList(): SDKTool[] { return this._tools; }

  /** 连接服务器并拉取工具列表 */
  async connect(): Promise<void> {
    this._status = 'connecting';
    this._error = undefined;

    try {
      // 动态加载 ESM SDK（subpath exports 需要 node16+ moduleResolution，此处用 @ts-ignore）
      // @ts-ignore — ESM subpath import, 运行时正常
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

      this.client = new Client(
        { name: 'IrisClaw', version: '1.0.0' },
        { capabilities: {} },
      );

      // 根据传输类型创建 transport
      if (this.config.transport === 'stdio') {
        // @ts-ignore — ESM subpath import
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        this.transport = new StdioClientTransport({
          command: this.config.command!,
          args: this.config.args,
          env: this.config.env ? { ...process.env as Record<string, string>, ...this.config.env } : undefined,
          cwd: this.config.cwd,
        });
      } else {
        // http 传输：优先使用 StreamableHTTPClientTransport
        // @ts-ignore — ESM subpath import
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        const opts: any = {};
        if (this.config.headers) {
          opts.requestInit = { headers: this.config.headers };
        }
        this.transport = new StreamableHTTPClientTransport(new URL(this.config.url!), opts);
      }

      // 带超时连接（timer 需手动清理防泄漏）
      const timeout = this.config.timeout ?? 30000;
      let timer: ReturnType<typeof setTimeout>;
      await Promise.race([
        this.client.connect(this.transport),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`连接超时（${timeout}ms）`)), timeout);
        }),
      ]).finally(() => clearTimeout(timer!));

      // 拉取工具列表（同样带超时）
      let timer2: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        this.client.listTools(),
        new Promise((_, reject) => {
          timer2 = setTimeout(() => reject(new Error(`listTools 超时（${timeout}ms）`)), timeout);
        }),
      ]).finally(() => clearTimeout(timer2!)) as any;
      this._tools = result.tools ?? [];
      this._status = 'connected';

      logger.info(`MCP 服务器 "${this.serverName}" 已连接，工具数: ${this._tools.length}`);
    } catch (err: unknown) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      this._tools = [];
      // 连接失败时清理（client.close 会关闭 transport 并发送协议关闭通知）
      try { await this.client?.close?.(); } catch { /* ignore */ }
      try { await this.transport?.close?.(); } catch { /* ignore */ }
      this.client = null;
      this.transport = null;
      logger.warn(`MCP 服务器 "${this.serverName}" 连接失败: ${this._error}`);
    }
  }

  /** 调用工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP 服务器 "${this.serverName}" 未连接`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    // 检查错误
    if (result.isError) {
      const text = this.extractText(result.content);
      throw new Error(text || `MCP 工具 "${name}" 执行失败`);
    }

    return this.extractText(result.content);
  }

  /** 从内容块数组中提取文本 */
  private extractText(content: SDKContentBlock[]): string {
    if (!Array.isArray(content)) return String(content);
    return content
      .filter((c: SDKContentBlock) => c.type === 'text' && c.text)
      .map((c: SDKContentBlock) => c.text)
      .join('\n');
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    try {
      // 优先通过 client 关闭（发送协议关闭通知 + 关闭 transport）
      if (this.client) {
        await this.client.close?.();
      } else if (this.transport) {
        await this.transport.close?.();
      }
    } catch {
      // 忽略关闭错误
    } finally {
      this.client = null;
      this.transport = null;
      this._tools = [];
      this._status = 'disconnected';
      this._error = undefined;
    }
  }
}
