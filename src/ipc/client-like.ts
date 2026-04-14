/**
 * IPCClientLike — IPC 客户端最小接口
 *
 * 从 IPCClient 中提取的最小接口，
 * 同时被 TCP IPCClient 和远程互联扩展的 WsIPCClient 实现，
 * 使 RemoteBackendHandle/RemoteToolHandle/RemoteApiProxy 对传输层无感知。
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
