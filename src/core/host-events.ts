/**
 * 宿主生命周期事件总线
 *
 * 全局单例 EventEmitter，由 IrisHost 发布 Agent / IPC 生命周期事件，
 * 供扩展插件响应和集成，无需直接依赖 IrisHost 内部实现。
 *
 * 事件列表：
 *   ipc-ready       { agentName, ipcPort }    IPC 服务已就绪
 *   agent-stopping  { agentName }             Agent 即将停止（热重载/销毁前）
 *   host-shutdown   无参数                     IrisHost 正在全局关停
 */

import { EventEmitter } from 'node:events';

export interface IpcReadyEvent {
  agentName: string;
  ipcPort: number;
}

export interface AgentStoppingEvent {
  agentName: string;
}

export const hostEvents = new EventEmitter();
