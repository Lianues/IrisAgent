/**
 * Net 模块类型定义
 *
 * 远程互联功能的共享类型：配置、认证消息、Relay 协议。
 */

// ============ 配置 ============

export interface NetConfig {
  /** 是否启用 Net WS 服务器（直连模式） */
  enabled?: boolean;
  /** WS 监听端口，默认 9100 */
  port?: number;
  /** WS 监听地址，默认 '0.0.0.0' */
  host?: string;
  /** 预共享认证 token */
  token?: string;
  /** 中继配置 */
  relay?: RelayConfig;
  /** 已保存的远程连接 */
  remotes?: Record<string, RemoteEntry>;
}

/** 已保存的远程连接条目 */
export interface RemoteEntry {
  url: string;
  /** 可选，有则一键连接，无则提示输入 */
  token?: string;
}

export interface RelayConfig {
  /** 中继服务器地址 (ws:// 或 wss://) */
  url?: string;
  /** 本节点在中继上的 ID */
  nodeId?: string;
  /** 中继认证 token */
  token?: string;
}

// ============ 认证消息 ============

export interface NetAuthMessage {
  type: 'auth';
  token: string;
}

// ============ Relay 协议 ============

export type RelayMessage =
  | { type: 'register'; nodeId: string; token: string }
  | { type: 'connect'; nodeId: string; token: string }
  | { type: 'paired' }
  | { type: 'peer_disconnected' }
  | { type: 'error'; message: string }
  | { type: 'data'; payload: unknown };

// ============ 连接状态 ============

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'closed';

// ============ 局域网发现 ============

export interface DiscoveryProbe {
  type: 'iris-discover';
  version: 1;
}

export interface DiscoveryResponse {
  type: 'iris-here';
  version: 1;
  name: string;
  port: number;
  agent?: string;
}

export interface DiscoveredInstance {
  name: string;
  host: string;
  port: number;
  agent?: string;
}
