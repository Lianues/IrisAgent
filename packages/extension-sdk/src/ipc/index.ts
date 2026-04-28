export type { IPCClientLike } from './client-like.js';
export { encodeFrame, FrameDecoder } from './framing.js';
export {
  ErrorCodes,
  Methods,
  Events,
  BACKEND_EVENT_TO_IPC,
  IPC_TO_BACKEND_EVENT,
  isRequest,
  isResponse,
  isNotification,
} from './protocol.js';
export type {
  IPCRequest,
  IPCResponse,
  IPCNotification,
  IPCError,
  IPCMessage,
  LockFileContent,
  SerializedToolHandle,
  HandshakeResult,
} from './protocol.js';
export { RemoteBackendHandle } from './remote-backend-handle.js';
export { RemoteToolHandle } from './remote-tool-handle.js';
export { createRemoteApiProxy } from './remote-api-proxy.js';

