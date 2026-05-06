/**
 * transport.ts —— SSH/SFTP 传输层
 *
 * 维护每个远端环境的一条可复用 SSH 连接，并按需打开/缓存 SFTP 子系统。
 * 上层翻译器根据 Host 的 `Transport` 字段选择：
 *   - auto/sftp：文件精确操作走 SFTP
 *   - bash：文件操作也走 SSH exec + bash/coreutils
 * 扫描/search/shell 始终走 exec。
 */

import { Client, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2';
import { promises as fs } from 'node:fs';
import type { ServerEntry } from './ssh-config.js';
import type { RemoteExecSshConfig } from './config.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
  /** 是否因超时被强制终止 */
  timedOut?: boolean;
}

interface PooledConnection {
  client: Client;
  ready: Promise<void>;
  sftp?: Promise<SFTPWrapper>;
  /** SFTP 子系统已探测不可用；避免 auto 模式每次文件操作重复探测 */
  sftpUnavailable?: string;
}

export class SshTransport {
  private readonly pool = new Map<string, PooledConnection>();

  constructor(
    private readonly servers: Map<string, ServerEntry>,
    private readonly sshCfg: RemoteExecSshConfig,
    private readonly logger?: { info: (m: string) => void; warn: (m: string) => void },
  ) {}

  getServer(alias: string): ServerEntry {
    const server = this.servers.get(alias);
    if (!server) throw new Error(`remote-exec: 未知服务器别名 "${alias}"`);
    return server;
  }

  getTransportMode(alias: string): 'auto' | 'sftp' | 'bash' {
    return this.getServer(alias).transport ?? 'auto';
  }

  /** 主动断开所有连接（deactivate / 配置 reload 时调用） */
  closeAll(): void {
    for (const [alias, conn] of this.pool) {
      try { conn.client.end(); } catch { /* ignore */ }
      this.logger?.info(`SSH 连接已关闭: ${alias}`);
    }
    this.pool.clear();
  }

  closeOne(alias: string): void {
    const conn = this.pool.get(alias);
    if (!conn) return;
    try { conn.client.end(); } catch { /* ignore */ }
    this.pool.delete(alias);
  }

  async execCommand(alias: string, command: string, signal?: AbortSignal, input?: Buffer | string): Promise<ExecResult> {
    const server = this.getServer(alias);
    const client = await this.acquire(alias, server);

    return new Promise<ExecResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;
      let exitSignal: string | undefined;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };

      client.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          cleanup();
          this.closeOne(alias);
          reject(err);
          return;
        }

        if (this.sshCfg.commandTimeoutMs > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            try { stream.signal('KILL'); } catch { /* ignore */ }
            try { stream.close(); } catch { /* ignore */ }
          }, this.sshCfg.commandTimeoutMs);
        }

        if (signal) {
          if (signal.aborted) {
            try { stream.close(); } catch { /* ignore */ }
          } else {
            onAbort = () => {
              try { stream.signal('INT'); } catch { /* ignore */ }
              try { stream.close(); } catch { /* ignore */ }
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        stream
          .on('close', (code: number | null, sig?: string) => {
            cleanup();
            exitCode = code;
            exitSignal = sig;
            resolve({ stdout, stderr, exitCode, signal: exitSignal, timedOut });
          })
          .on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
        stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

        if (input !== undefined) stream.end(input);
        else stream.end();
      });
    });
  }

  // ── SFTP helpers ──

  async getSftp(alias: string): Promise<SFTPWrapper> {
    const server = this.getServer(alias);
    const conn = await this.acquireConnection(alias, server);
    if (conn.sftpUnavailable) {
      throw new Error(conn.sftpUnavailable);
    }
    if (!conn.sftp) {
      conn.sftp = new Promise<SFTPWrapper>((resolve, reject) => {
        conn.client.sftp((err, sftp) => {
          if (err) {
            conn.sftp = undefined;
            conn.sftpUnavailable = `SFTP 子系统不可用 (${alias}): ${err.message}`;
            reject(new Error(conn.sftpUnavailable));
            return;
          }
          resolve(sftp);
        });
      });
    }
    return conn.sftp;
  }

  async sftpReadFile(alias: string, remotePath: string): Promise<Buffer> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => err ? reject(err) : resolve(Buffer.isBuffer(data) ? data : Buffer.from(data)));
    });
  }

  async sftpWriteFile(alias: string, remotePath: string, data: Buffer | string): Promise<void> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, data, (err) => err ? reject(err) : resolve());
    });
  }

  async sftpReaddir(alias: string, remotePath: string): Promise<Array<{ filename: string; longname: string; attrs: Stats }>> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
    });
  }

  async sftpStat(alias: string, remotePath: string): Promise<Stats> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, st) => err ? reject(err) : resolve(st));
    });
  }

  async sftpMkdir(alias: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => err ? reject(err) : resolve());
    });
  }

  async sftpUnlink(alias: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => err ? reject(err) : resolve());
    });
  }

  async sftpRmdir(alias: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve());
    });
  }

  // ── 连接池 ──

  private async acquire(alias: string, server: ServerEntry): Promise<Client> {
    const conn = await this.acquireConnection(alias, server);
    return conn.client;
  }

  private async acquireConnection(alias: string, server: ServerEntry): Promise<PooledConnection> {
    if (this.sshCfg.reuseConnection) {
      const existing = this.pool.get(alias);
      if (existing) {
        await existing.ready;
        return existing;
      }
    }

    const client = new Client();
    const conn: PooledConnection = {
      client,
      ready: new Promise<void>((resolve, reject) => {
        client
          .on('ready', () => {
            this.logger?.info(`SSH 连接已就绪: ${alias} (${server.user ?? ''}@${server.hostName}:${server.port})`);
            resolve();
          })
          .on('error', (err) => {
            this.logger?.warn(`SSH 连接错误 (${alias}): ${err.message}`);
            this.pool.delete(alias);
            reject(err);
          })
          .on('end', () => { this.pool.delete(alias); })
          .on('close', () => { this.pool.delete(alias); });
      }),
    };

    if (this.sshCfg.reuseConnection) this.pool.set(alias, conn);

    const connectCfg = await buildConnectConfig(server, this.sshCfg);
    client.connect(connectCfg);

    try {
      await conn.ready;
    } catch (err) {
      this.pool.delete(alias);
      throw err;
    }
    return conn;
  }
}

async function buildConnectConfig(s: ServerEntry, sshCfg: RemoteExecSshConfig): Promise<ConnectConfig> {
  const cfg: ConnectConfig = {
    host: s.hostName,
    port: s.port,
    username: s.user,
    readyTimeout: sshCfg.connectTimeoutMs,
    keepaliveInterval: sshCfg.keepAliveSec > 0 ? sshCfg.keepAliveSec * 1000 : 0,
  };

  if (s.identityFile) {
    try {
      cfg.privateKey = await fs.readFile(s.identityFile);
    } catch (err) {
      throw new Error(`remote-exec: 无法读取 IdentityFile "${s.identityFile}" (Host=${s.host}): ${(err as Error).message}`);
    }
  } else if (s.password) {
    cfg.password = s.password;
  } else {
    throw new Error(`remote-exec: 服务器 "${s.host}" 既未配置 IdentityFile 也未配置 Password，无法认证`);
  }
  return cfg;
}
