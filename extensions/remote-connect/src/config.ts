/**
 * 远程互联配置解析器
 *
 * 从 net.yaml 原始数据解析配置。
 */

import type { NetConfig, RemoteEntry } from './types';

export function parseNetConfig(raw: any): NetConfig | undefined {
  if (!raw) return undefined;

  const config: NetConfig = {
    enabled: raw.enabled === true,
    port: typeof raw.port === 'number' ? raw.port : 9100,
    host: typeof raw.host === 'string' ? raw.host : '0.0.0.0',
    token: typeof raw.token === 'string' ? raw.token : undefined,
    gatewayAgent: typeof raw.gatewayAgent === 'string' && raw.gatewayAgent.trim() ? raw.gatewayAgent.trim() : 'master',
  };

  if (raw.relay && typeof raw.relay === 'object') {
    config.relay = {
      url: typeof raw.relay.url === 'string' ? raw.relay.url : undefined,
      nodeId: typeof raw.relay.nodeId === 'string' ? raw.relay.nodeId : undefined,
      token: typeof raw.relay.token === 'string' ? raw.relay.token : undefined,
    };
  }

  if (raw.remotes && typeof raw.remotes === 'object') {
    const remotes: Record<string, RemoteEntry> = {};
    for (const [name, entry] of Object.entries(raw.remotes)) {
      if (entry && typeof entry === 'object' && typeof (entry as any).url === 'string') {
        remotes[name] = {
          url: (entry as any).url,
          token: typeof (entry as any).token === 'string' ? (entry as any).token : undefined,
        };
      }
    }
    if (Object.keys(remotes).length > 0) {
      config.remotes = remotes;
    }
  }

  return config;
}

/** net.yaml 默认配置模板 */
export const NET_CONFIG_TEMPLATE = `# 远程互联配置
# 启用后可从远程设备控制本 Iris 实例

# 直连模式：启动 WebSocket 服务器
# enabled: true
# port: 9100
# host: 0.0.0.0
# token: your-secret-token-here

# 多 Agent 网关：只由一个 Agent 启动远程入口
# 远程连接到该入口后，可在远程 Console 内切换/使用其他 Agent。
# 默认 master；如需改用其他 Agent 作为入口，可修改为对应 agent 名称。
# gatewayAgent: master

# 局域网发现：启用后可被同网络的 Iris 实例自动发现
# 发现使用 UDP 端口 (port + 1)，默认 9101
# 发现响应不包含 token，安全可靠

# 已保存的远程连接（/remote 命令中显示为快捷列表）
# remotes:
#   my-linux:
#     url: ws://192.168.1.100:9100
#     token: my-secret-token
#   my-server:
#     url: ws://10.0.0.5:9100

# 中继模式：注册到中继服务器（用于 NAT 穿透）
# relay:
#   url: wss://your-relay-server:9001
#   nodeId: my-iris
#   token: relay-secret-token
`;
