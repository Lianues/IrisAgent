/**
 * 插件事件总线
 *
 * 独立于 Backend EventEmitter，专供插件之间通信使用。
 * 插件也可以直接用 Backend.emit 发射自定义事件，但这个总线提供更干净的隔离。
 */

import { EventEmitter } from 'events';

export class PluginEventBus extends EventEmitter {
  /** 发射事件（与 EventEmitter.emit 相同，但类型更宽松） */
  fire(event: string, ...args: unknown[]): boolean {
    return this.emit(event, ...args);
  }
}
