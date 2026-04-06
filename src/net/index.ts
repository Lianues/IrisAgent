/**
 * Net 模块 — 多端互联
 *
 * 提供跨设备远程控制 Iris 实例的能力：
 *   - NetServer: WS→TCP 桥接，使远程设备可通过 WebSocket 控制本地 IPCServer
 *   - WsIPCClient: WebSocket IPC 客户端，用于 iris attach --remote
 *   - RelayHub: 中继服务器，用于 NAT 穿透
 *   - RelayNodeClient: 中继节点客户端，将本实例注册到中继
 */

export { NetServer } from './server';
export { WsIPCClient } from './client';
export { RelayHub, runRelay } from './relay';
export { RelayNodeClient } from './relay-node';
export { constantTimeEqual, validateAuthMessage } from './auth';
export { DiscoveryListener, discoverLanInstances } from './discovery';
export type { NetConfig, RelayConfig, NetAuthMessage, RelayMessage, ConnectionState, RemoteEntry, DiscoveredInstance } from './types';
