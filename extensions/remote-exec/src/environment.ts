/**
 * environment.ts
 *
 * 维护"当前活动环境"的状态。
 *
 * 状态作用域：按 agent 隔离（同 agent 跨会话保留，便于 AI 重新开聊后仍在远端环境中）。
 * 通过 globalStore.agent(agentName).namespace('remote-exec') 持久化。
 *
 * 暴露 EnvironmentManager 给 wrap.ts 和 switch_environment 工具调用。
 */

import type { GlobalStoreLike, IrisAPI } from 'irises-extension-sdk';
import { LOCAL_ENV, type RemoteExecConfig } from './config.js';
import type { ServerEntry } from './ssh-config.js';

const KEY_ACTIVE_ENV = 'activeEnvironment';

export interface EnvSummary {
  name: string;
  isLocal: boolean;
  description?: string;
  hostName?: string;
  user?: string;
  workdir?: string;
}

export class EnvironmentManager {
  private store: GlobalStoreLike;

  constructor(
    api: IrisAPI,
    private getServers: () => Map<string, ServerEntry>,
    private getConfig: () => RemoteExecConfig,
  ) {
    const agentName = api.agentName ?? '__global__';
    this.store = api.globalStore.agent(agentName).namespace('remote-exec');
  }

  /** 当前活动环境名（local 或 Host 别名）。配置变化或服务器被删时回退到 local */
  getActive(): string {
    const stored = this.store.get<string>(KEY_ACTIVE_ENV);
    if (stored && stored !== LOCAL_ENV && !this.getServers().has(stored)) {
      // 引用的服务器已被删除：自动回退
      this.store.set(KEY_ACTIVE_ENV, LOCAL_ENV);
      return LOCAL_ENV;
    }
    return stored ?? this.getConfig().defaultEnvironment ?? LOCAL_ENV;
  }

  /** 切换活动环境；返回前后状态便于工具回报 */
  setActive(name: string): { previous: string; current: string } {
    const previous = this.getActive();
    if (name !== LOCAL_ENV && !this.getServers().has(name)) {
      throw new Error(`未知环境 "${name}"。可用环境：${this.listEnvs().map(e => e.name).join(', ')}`);
    }
    this.store.set(KEY_ACTIVE_ENV, name);
    return { previous, current: name };
  }

  /** 当前活动环境对应的 ServerEntry；返回 null 表示本地环境 */
  getActiveServer(): ServerEntry | null {
    const name = this.getActive();
    if (name === LOCAL_ENV) return null;
    return this.getServers().get(name) ?? null;
  }

  /** 列出所有可用环境（local + 所有 Host） */
  listEnvs(): EnvSummary[] {
    const list: EnvSummary[] = [
      { name: LOCAL_ENV, isLocal: true, description: '本机（不通过 SSH，直接在本地执行所有工具）' },
    ];
    for (const s of this.getServers().values()) {
      list.push({
        name: s.host,
        isLocal: false,
        description: s.description ? `${s.description} (transport=${s.transport ?? 'auto'})` : `transport=${s.transport ?? 'auto'}`,
        hostName: s.hostName,
        user: s.user,
        workdir: s.workdir,
      });
    }
    return list;
  }
}
