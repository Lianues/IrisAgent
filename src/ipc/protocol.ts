/**
 * @deprecated IPC 协议定义已迁移到 irises-extension-sdk/ipc。
 * 此文件仅作为宿主内部旧导入路径的兼容层。
 */
export {
  ErrorCodes,
  Methods,
  Events,
  BACKEND_EVENT_TO_IPC,
  IPC_TO_BACKEND_EVENT,
  isRequest,
  isResponse,
  isNotification,
} from 'irises-extension-sdk/ipc';
export type {
  IPCRequest,
  IPCResponse,
  IPCNotification,
  IPCError,
  IPCMessage,
  LockFileContent,
  SerializedToolHandle,
  HandshakeResult,
} from 'irises-extension-sdk/ipc';
