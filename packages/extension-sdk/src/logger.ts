/**
 * 扩展日志模块
 *
 * 与核心层 src/logger/ 行为对齐：
 *   - 支持全局日志级别过滤（DEBUG=0, INFO=1, WARN=2, ERROR=3, SILENT=4）
 *   - 低于当前级别的日志不输出
 *   - 宿主在 setLogLevel 时会同步到此处
 */

// 日志级别常量（值与核心层 LogLevel 及 SDK plugin.ts 中的 LogLevel 枚举一致）
const LOG_DEBUG = 0;
const LOG_INFO = 1;
const LOG_WARN = 2;
const LOG_ERROR = 3;

/** 全局日志级别，所有扩展 logger 实例共享 */
let _logLevel: number = LOG_INFO;

/** 设置扩展日志级别（宿主在 setLogLevel 时自动同步） */
export function setExtensionLogLevel(level: number): void {
  _logLevel = level;
}

/** 获取当前扩展日志级别 */
export function getExtensionLogLevel(): number {
  return _logLevel;
}

export interface ExtensionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export function createExtensionLogger(extensionName: string, tag?: string): ExtensionLogger {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => { if (_logLevel <= LOG_DEBUG) console.debug(`[${scope}]`, ...args); },
    info: (...args) => { if (_logLevel <= LOG_INFO) console.log(`[${scope}]`, ...args); },
    warn: (...args) => { if (_logLevel <= LOG_WARN) console.warn(`[${scope}]`, ...args); },
    error: (...args) => { if (_logLevel <= LOG_ERROR) console.error(`[${scope}]`, ...args); },
  };
}
