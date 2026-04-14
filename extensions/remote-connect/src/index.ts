/**
 * remote-connect — 远程互联插件
 *
 * 提供跨设备远程控制 Iris 实例的能力：
 *   - NetServer: WS→TCP 桥接，使远程设备可通过 WebSocket 控制本地 IPCServer
 *   - WsIPCClient: WebSocket IPC 客户端，用于远程连接
 *   - RelayHub: 中继服务器，用于 NAT 穿透
 *   - RelayNodeClient: 中继节点客户端，将本实例注册到中继
 *   - DiscoveryListener / discoverLanInstances: 局域网 UDP 发现
 *
 * 服务端生命周期由插件自动管理：
 *   监听 hostEvents 的 ipc-ready / agent-stopping / host-shutdown 事件，
 *   自动启停 NetServer 和 RelayNodeClient，无需 IrisHost 感知。
 */

import { definePlugin } from 'irises-extension-sdk';
import type { PluginContext } from 'irises-extension-sdk';
import { hostEvents } from '../../../src/core/host-events';
import type { IpcReadyEvent, AgentStoppingEvent } from '../../../src/core/host-events';
import { NetServer } from './server';
import { RelayNodeClient } from './relay-node';
import { parseNetConfig, NET_CONFIG_TEMPLATE } from './config';
import { WsIPCClient } from './client';
import { discoverLanInstances } from './discovery';

// ── 插件状态（模块级，跨 activate / deactivate） ──

const netServers = new Map<string, NetServer>();
const relayNodes = new Map<string, RelayNodeClient>();
let pluginCtx: PluginContext | null = null;

// ── 事件处理 ──

async function onIpcReady({ agentName, ipcPort }: IpcReadyEvent) {
  if (!pluginCtx) return;

  const rawConfig = pluginCtx.readConfigSection('net');
  const config = parseNetConfig(rawConfig);
  if (!config) return;

  const logger = pluginCtx.getLogger();

  // 启动直连 WS 桥接服务器
  if (config.enabled && config.token) {
    try {
      const netServer = new NetServer({ ipcPort, config, agentName });
      await netServer.start();
      netServers.set(agentName, netServer);
      logger.info(`远程互联服务已启动: ${config.host ?? '0.0.0.0'}:${config.port ?? 9100} (agent=${agentName})`);
    } catch (err) {
      logger.warn(`远程互联服务启动失败 (agent=${agentName}): ${(err as Error).message}`);
    }
  }

  // 注册到中继服务器
  const relay = config.relay;
  if (relay?.url && relay?.nodeId && relay?.token) {
    try {
      const relayNode = new RelayNodeClient({ ipcPort, relay });
      relayNode.start();
      relayNodes.set(agentName, relayNode);
      logger.info(`Relay 节点已注册: nodeId=${relay.nodeId} → ${relay.url} (agent=${agentName})`);
    } catch (err) {
      logger.warn(`Relay 节点启动失败 (agent=${agentName}): ${(err as Error).message}`);
    }
  }
}

function onAgentStopping({ agentName }: AgentStoppingEvent) {
  const netServer = netServers.get(agentName);
  if (netServer) {
    netServer.stop().catch(() => {});
    netServers.delete(agentName);
  }
  const relayNode = relayNodes.get(agentName);
  if (relayNode) {
    relayNode.stop();
    relayNodes.delete(agentName);
  }
}

function onHostShutdown() {
  for (const server of netServers.values()) {
    server.stop().catch(() => {});
  }
  netServers.clear();
  for (const node of relayNodes.values()) {
    node.stop();
  }
  relayNodes.clear();
}

// ── 插件定义 ──

export default definePlugin({
  name: 'remote-connect',
  version: '0.1.0',
  description: '远程互联插件 — 跨设备远程控制 Iris 实例（直连 / 中继 / 局域网发现）',

  activate(ctx: PluginContext) {
    pluginCtx = ctx;

    // 释放默认配置文件
    ctx.ensureConfigFile('net.yaml', NET_CONFIG_TEMPLATE);

    // 注册服务供其他扩展使用（如 console 的远程连接向导）
    const sr = ctx.getServiceRegistry();
    sr.register('remote-connect:WsIPCClient', WsIPCClient);
    sr.register('remote-connect:discoverLanInstances', discoverLanInstances);

    // 监听宿主生命周期事件
    hostEvents.on('ipc-ready', onIpcReady);
    hostEvents.on('agent-stopping', onAgentStopping);
    hostEvents.on('host-shutdown', onHostShutdown);
  },

  async deactivate() {
    // 移除事件监听
    hostEvents.off('ipc-ready', onIpcReady);
    hostEvents.off('agent-stopping', onAgentStopping);
    hostEvents.off('host-shutdown', onHostShutdown);

    // 停止所有服务
    onHostShutdown();
    pluginCtx = null;
  },
});

// ── 库导出（供其他扩展直接 import 子模块使用） ──

export { NetServer } from './server';
export { WsIPCClient } from './client';
export { RelayHub, runRelay } from './relay';
export { RelayNodeClient } from './relay-node';
export { constantTimeEqual, validateAuthMessage } from './auth';
export { DiscoveryListener, discoverLanInstances } from './discovery';
export { parseNetConfig, NET_CONFIG_TEMPLATE } from './config';
export { runNetCommand } from './command';
export type { NetConfig, RelayConfig, NetAuthMessage, RelayMessage, ConnectionState, RemoteEntry, DiscoveredInstance } from './types';
