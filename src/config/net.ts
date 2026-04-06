/**
 * Net 配置解析器
 *
 * 从 net.yaml 解析多端互联配置。
 */

import type { NetConfig, RemoteEntry } from '../net/types';

export function parseNetConfig(raw: any): NetConfig | undefined {
  if (!raw) return undefined;

  const config: NetConfig = {
    enabled: raw.enabled === true,
    port: typeof raw.port === 'number' ? raw.port : 9100,
    host: typeof raw.host === 'string' ? raw.host : '0.0.0.0',
    token: typeof raw.token === 'string' ? raw.token : undefined,
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
