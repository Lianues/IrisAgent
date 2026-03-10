/**
 * 用户交互层 —— 平台适配器基类
 *
 * 所有平台（Discord、Telegram、Console 等）均需继承此基类。
 * 平台适配器负责：
 *   1. 接收用户消息，转换为内部 IncomingMessage 格式
 *   2. 将 AI 的回复发送给用户
 */

import { MessageHandler } from '../types';
import { ToolStateManager } from '../tools/state';

/** 将文本按最大长度分段，优先在换行处切分 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

export type ClearHandler = (sessionId: string) => Promise<void>;

export abstract class PlatformAdapter {
  protected messageHandler?: MessageHandler;
  protected clearHandler?: ClearHandler;

  /** 注册消息处理回调（由 Orchestrator 调用） */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** 注册清空会话回调（由 Orchestrator 调用） */
  onClear(handler: ClearHandler): void {
    this.clearHandler = handler;
  }

  /** 启动平台（连接服务、开始监听） */
  abstract start(): Promise<void>;

  /** 停止平台 */
  abstract stop(): Promise<void>;

  /** 向指定会话发送文本消息 */
  abstract sendMessage(sessionId: string, text: string): Promise<void>;

  /**
   * 流式发送消息（可选覆写）
   * 默认实现：收集全部文本后调用 sendMessage 一次性发送。
   * 支持流式的平台（如 Console）可覆写此方法实现逐块输出。
   */
  async sendMessageStream(sessionId: string, stream: AsyncIterable<string>): Promise<void> {
    let full = '';
    for await (const chunk of stream) { full += chunk; }
    if (full) await this.sendMessage(sessionId, full);
  }

  /**
   * 接收工具状态管理器（可选覆写）
   *
   * 由 Orchestrator 在 start() 时调用。
   * 平台可监听 ToolStateManager 的事件以实时显示工具执行状态。
   * 默认实现为空操作，不关心工具状态的平台无需覆写。
   */
  setToolStateManager(_manager: ToolStateManager): void {
    // 默认不处理
  }

  /** 平台名称 */
  get name(): string {
    return this.constructor.name;
  }
}
