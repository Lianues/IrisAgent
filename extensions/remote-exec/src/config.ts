/**
 * config.ts —— 解析 remote_exec.yaml 主配置
 */

import YAML from 'yaml';

export interface RemoteExecSshConfig {
  reuseConnection: boolean;
  connectTimeoutMs: number;
  keepAliveSec: number;
  commandTimeoutMs: number;
}

export interface RemoteExecConfig {
  enabled: boolean;
  defaultEnvironment: string; // 'local' 或 Host 别名
  exposeSwitchTool: boolean;
  remoteWorkdir?: string;
  ssh: RemoteExecSshConfig;
}

export const LOCAL_ENV = 'local';

const DEFAULTS: RemoteExecConfig = {
  enabled: false,
  defaultEnvironment: LOCAL_ENV,
  exposeSwitchTool: true,
  remoteWorkdir: undefined,
  ssh: {
    reuseConnection: true,
    connectTimeoutMs: 10000,
    keepAliveSec: 30,
    commandTimeoutMs: 0,
  },
};

export function parseRemoteExecConfig(raw: unknown): RemoteExecConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const ssh = (r.ssh && typeof r.ssh === 'object' ? r.ssh : {}) as Record<string, unknown>;

  return {
    enabled: r.enabled === true,
    defaultEnvironment:
      typeof r.defaultEnvironment === 'string' && r.defaultEnvironment.trim()
        ? r.defaultEnvironment.trim()
        : LOCAL_ENV,
    exposeSwitchTool: r.exposeSwitchTool !== false,
    remoteWorkdir:
      typeof r.remoteWorkdir === 'string' && r.remoteWorkdir.trim()
        ? r.remoteWorkdir.trim()
        : undefined,
    ssh: {
      reuseConnection: ssh.reuseConnection !== false,
      connectTimeoutMs: toFiniteNumber(ssh.connectTimeoutMs, DEFAULTS.ssh.connectTimeoutMs),
      keepAliveSec: toFiniteNumber(ssh.keepAliveSec, DEFAULTS.ssh.keepAliveSec),
      commandTimeoutMs: toFiniteNumber(ssh.commandTimeoutMs, DEFAULTS.ssh.commandTimeoutMs),
    },
  };
}

export function parseRemoteExecYaml(text: string): RemoteExecConfig {
  try {
    return parseRemoteExecConfig(YAML.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
}

function toFiniteNumber(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : def;
}
