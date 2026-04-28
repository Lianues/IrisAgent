/**
 * IPCClientLike — IPC 客户端最小接口
 *
 * 供宿主 IPC 客户端、远程互联 WebSocket 客户端，以及远程 Backend/API 代理共享。
 * 放在 SDK 中可以避免 extension 直接依赖宿主 src/ipc 内部路径。
 */

export interface IPCClientLike {
  /** 发送 RPC 请求，等待响应 */
  call(method: string, params?: unknown[], options?: { timeout?: number }): Promise<unknown>;

  /** 注册事件通知回调 */
  onNotification(handler: (method: string, params: unknown[]) => void): void;

  /** 移除事件通知回调 */
  offNotification(handler: (method: string, params: unknown[]) => void): void;

  /** 订阅指定 session 的事件 */
  subscribe(sessions: string | string[]): Promise<void>;

  /** 断开连接 */
  disconnect(): void;

  /** 连接状态 */
  isConnected(): boolean;
}
