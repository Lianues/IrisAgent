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
import { hostEvents, type IpcReadyEvent, type AgentStoppingEvent } from 'irises-extension-sdk/host-events';
import type { Disposable, IrisAPI, PluginContext } from 'irises-extension-sdk';
import { NetServer } from './server';
import { RelayNodeClient } from './relay-node';
import { parseNetConfig, NET_CONFIG_TEMPLATE } from './config';
import { WsIPCClient } from './client';
import { discoverLanInstances } from './discovery';

// ── 插件状态（模块级，跨 activate / deactivate） ──

const DEFAULT_GATEWAY_AGENT = 'master';

const netServers = new Map<string, NetServer>();
const relayNodes = new Map<string, RelayNodeClient>();
interface AgentRuntimeRefs {
  ctx: PluginContext;
  api: IrisAPI;
}

const contextsByAgent = new Map<string, AgentRuntimeRefs>();
const serviceDisposersByRegistry = new WeakMap<object, Disposable[]>();
const agentNamesByContext = new WeakMap<object, string>();
let hostEventListenersRegistered = false;

// ── 事件处理 ──

async function onIpcReady({ agentName, ipcPort }: IpcReadyEvent) {
  const runtime = contextsByAgent.get(agentName);
  if (!runtime) return;
  const { ctx } = runtime;

  const rawConfig = readNetConfig(runtime);
  const config = parseNetConfig(rawConfig);
  if (!config) return;

  const gatewayAgent = config.gatewayAgent ?? DEFAULT_GATEWAY_AGENT;
  if (agentName !== gatewayAgent) return;
  if (netServers.has(agentName) || relayNodes.has(agentName)) return;

  const logger = ctx.getLogger();

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

function readNetConfig(runtime: AgentRuntimeRefs): Record<string, unknown> | undefined {
  const merged = runtime.api.configManager?.readEditableConfig?.() as Record<string, unknown> | undefined;
  const fromMerged = merged?.net;
  if (fromMerged && typeof fromMerged === 'object' && !Array.isArray(fromMerged)) {
    return fromMerged as Record<string, unknown>;
  }
  return runtime.ctx.readConfigSection('net');
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
  contextsByAgent.delete(agentName);
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
  contextsByAgent.clear();
}

function registerInteropServices(ctx: PluginContext): void {
  const sr = ctx.getServiceRegistry();
  registerInteropServicesForRegistry(sr);
}

function registerInteropServicesForRegistry(
  sr: ReturnType<PluginContext['getServiceRegistry']>,
): void {
  const registryKey = sr as unknown as object;
  serviceDisposersByRegistry.get(registryKey)?.forEach(d => d.dispose());
  serviceDisposersByRegistry.set(registryKey, [
    sr.register('remote-connect:WsIPCClient', WsIPCClient),
    sr.register('remote-connect:discoverLanInstances', discoverLanInstances),
  ]);
}

function ensureHostEventListeners(): void {
  if (hostEventListenersRegistered) return;
  hostEventListenersRegistered = true;
  hostEvents.on('ipc-ready', onIpcReady);
  hostEvents.on('agent-stopping', onAgentStopping);
  hostEvents.on('host-shutdown', onHostShutdown);
}

function disposeInteropServices(ctx: PluginContext): void {
  const registryKey = ctx.getServiceRegistry() as unknown as object;
  serviceDisposersByRegistry.get(registryKey)?.forEach(d => d.dispose());
  serviceDisposersByRegistry.delete(registryKey);
}




// ── 插件定义 ──

export default definePlugin({
  name: 'remote-connect',
  version: '0.1.0',
  description: '远程互联插件 — 跨设备远程控制 Iris 实例（直连 / 中继 / 局域网发现）',

  activate(ctx: PluginContext) {
    // 释放默认配置文件
    ctx.ensureConfigFile('net.yaml', NET_CONFIG_TEMPLATE);

    ctx.onReady((api) => {
      contextsByAgent.set(api.agentName ?? 'master', { ctx, api });
      agentNamesByContext.set(ctx as unknown as object, api.agentName ?? 'master');
    });

    // 注册服务供其他扩展使用（如 console 的远程连接向导）
    registerInteropServices(ctx);

    // 监听宿主生命周期事件
    ensureHostEventListeners();
  },

  async deactivate(ctx?: PluginContext) {
    if (!ctx) return;
    const agentName = agentNamesByContext.get(ctx as unknown as object);
    disposeInteropServices(ctx);
    if (agentName) {
      onAgentStopping({ agentName });
      agentNamesByContext.delete(ctx as unknown as object);
    }
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
