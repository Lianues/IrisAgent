/**
 * 局域网发现模块
 *
 * 服务端：DiscoveryListener 监听 UDP 端口，响应发现探测。
 * 客户端：discoverLanInstances 发送 UDP 广播，收集同网段 Iris 实例。
 *
 * 协议：请求-响应模式，不持续广播，不暴露 token。
 */

import * as dgram from 'node:dgram';
import * as os from 'node:os';
import { createExtensionLogger } from 'irises-extension-sdk';
import type { DiscoveryProbe, DiscoveryResponse, DiscoveredInstance } from './types';

const logger = createExtensionLogger('Discovery');

const isWindows = process.platform === 'win32';

// ============ 服务端 ============

export class DiscoveryListener {
  private socket: dgram.Socket | null = null;
  private port: number;
  private wsPort: number;
  private agentName?: string;

  constructor(opts: { discoveryPort: number; wsPort: number; agentName?: string }) {
    this.port = opts.discoveryPort;
    this.wsPort = opts.wsPort;
    this.agentName = opts.agentName;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      try {
        // Windows 上不使用 reuseAddr 以避免端口劫持
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: !isWindows });

        this.socket.on('message', (msg, rinfo) => {
          this.handleProbe(msg, rinfo);
        });

        // bind 失败时 error 事件先于 listening 触发 → 必须在此 resolve
        this.socket.on('error', (err) => {
          logger.warn(`Discovery UDP 错误: ${err.message}`);
          if (!settled) {
            // bind 失败，清理并静默 resolve（非致命）
            try { this.socket?.close(); } catch {}
            this.socket = null;
            done();
          }
          // 运行时错误：仅日志
        });

        this.socket.bind(this.port, () => {
          logger.info(`Discovery 监听 UDP :${this.port}`);
          done();
        });
      } catch (err) {
        // dgram 不可用时静默失败
        logger.warn(`Discovery 启动失败: ${(err as Error).message}`);
        if (this.socket) {
          try { this.socket.close(); } catch {}
          this.socket = null;
        }
        done();
      }
    });
  }

  stop(): void {
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }

  private handleProbe(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const probe: DiscoveryProbe = JSON.parse(msg.toString('utf-8'));
      if (probe.type !== 'iris-discover' || probe.version !== 1) return;

      const response: DiscoveryResponse = {
        type: 'iris-here',
        version: 1,
        name: os.hostname(),
        port: this.wsPort,
        agent: this.agentName,
      };

      const buf = Buffer.from(JSON.stringify(response), 'utf-8');
      this.socket?.send(buf, 0, buf.length, rinfo.port, rinfo.address);
    } catch {
      // 非法消息，忽略
    }
  }
}

// ============ 客户端 ============

/**
 * 发送 UDP 广播探测局域网中的 Iris 实例。
 * @param discoveryPort 目标发现端口（默认 9101）
 * @param timeoutMs 收集响应的超时时间（默认 2000ms）
 */
export function discoverLanInstances(
  discoveryPort = 9101,
  timeoutMs = 2000,
): Promise<DiscoveredInstance[]> {
  return new Promise((resolve) => {
    const results: DiscoveredInstance[] = [];
    const seen = new Set<string>();
    let resolved = false;

    // 收集本机所有 IP，用于过滤自我发现
    const localIPs = new Set<string>();
    try {
      const ifaces = os.networkInterfaces();
      for (const addrs of Object.values(ifaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
          if (addr.family === 'IPv4') localIPs.add(addr.address);
        }
      }
    } catch {}
    localIPs.add('127.0.0.1');

    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: 'udp4' });
    } catch {
      resolve([]);
      return;
    }

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(results);
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on('message', (msg, rinfo) => {
      if (resolved) return;
      try {
        const resp: DiscoveryResponse = JSON.parse(msg.toString('utf-8'));
        if (resp.type !== 'iris-here' || resp.version !== 1) return;

        // 过滤掉本机（自我发现）
        if (localIPs.has(rinfo.address)) return;

        const key = `${rinfo.address}:${resp.port}`;
        if (seen.has(key)) return;
        seen.add(key);

        results.push({
          name: resp.name,
          host: rinfo.address,
          port: resp.port,
          agent: resp.agent,
        });
      } catch {
        // 无效响应，忽略
      }
    });

    socket.on('error', finish);

    socket.bind(0, () => {
      if (resolved) return;
      try {
        socket.setBroadcast(true);
        const probe: DiscoveryProbe = { type: 'iris-discover', version: 1 };
        const buf = Buffer.from(JSON.stringify(probe), 'utf-8');
        socket.send(buf, 0, buf.length, discoveryPort, '255.255.255.255');
      } catch {
        finish();
      }
    });
  });
}
