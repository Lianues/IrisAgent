/**
 * 宿主生命周期事件总线
 *
 * 用于宿主发布 Agent / IPC 生命周期事件，供扩展插件响应。
 *
 * 注意：扩展构建时可能会把 SDK 打进自己的 bundle。为了避免“宿主一份
 * EventEmitter、扩展 bundle 里又一份 EventEmitter”的单例分裂问题，这里通过
 * globalThis + Symbol.for 存储真实实例，保证同一 JS Realm 内所有副本共享同一个总线。
 */

import { EventEmitter } from 'node:events';

export interface IpcReadyEvent {
  agentName: string;
  ipcPort: number;
}

export interface AgentStoppingEvent {
  agentName: string;
}

export type HostEventName = 'ipc-ready' | 'agent-stopping' | 'host-shutdown';

const HOST_EVENTS_SYMBOL = Symbol.for('irises.hostEvents');

const hostEventsGlobal = globalThis as Record<PropertyKey, unknown>;

export const hostEvents: EventEmitter = hostEventsGlobal[HOST_EVENTS_SYMBOL]
  ? hostEventsGlobal[HOST_EVENTS_SYMBOL] as EventEmitter
  : (hostEventsGlobal[HOST_EVENTS_SYMBOL] = new EventEmitter()) as EventEmitter;
