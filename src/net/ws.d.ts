/**
 * ws 包类型声明（最小）
 *
 * ws 仅作为 Node.js/tsx 运行时的降级方案使用，
 * Bun 环境下使用原生 WebSocket，不需要 ws 包。
 */
declare module 'ws' {
  export class WebSocket {
    constructor(url: string);
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    ping(): void;
    terminate(): void;
    readonly readyState: number;
    onopen: ((event: any) => void) | null;
    onmessage: ((event: { data: any }) => void) | null;
    onerror: ((event: any) => void) | null;
    onclose: ((event: any) => void) | null;
    on(event: string, listener: (...args: any[]) => void): void;
  }

  export class WebSocketServer {
    constructor(options: { host?: string; port?: number });
    on(event: 'connection', listener: (ws: WebSocket, req: any) => void): void;
    close(callback?: () => void): void;
  }

  export default WebSocket;
}
