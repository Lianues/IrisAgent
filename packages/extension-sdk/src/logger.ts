export interface ExtensionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

function print(level: 'log' | 'warn' | 'error' | 'debug', scope: string, args: unknown[]): void {
  const consoleMethod = console[level] ?? console.log;
  consoleMethod(`[${scope}]`, ...args);
}

export function createExtensionLogger(extensionName: string, tag?: string): ExtensionLogger {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    info: (...args) => print('log', scope, args),
    warn: (...args) => print('warn', scope, args),
    error: (...args) => print('error', scope, args),
    debug: (...args) => print('debug', scope, args),
  };
}
