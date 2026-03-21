/**
 * HTTP 请求模块
 *
 * 通用的 HTTP 发送逻辑，不含任何格式转换。
 * 支持流式和非流式请求，通过 streamUrl 字段区分 URL。
 */

import { logRequest, logResponse } from '../logger/request-logger';

export interface EndpointConfig {
  /** 非流式请求 URL */
  url: string;
  /**流式请求 URL（与非流式不同时使用，如 Gemini），默认同 url */
  streamUrl?: string;
  /** 请求头（不含 Content-Type，内部自动加） */
  headers: Record<string, string>;
}

/** 非流式请求默认超时（毫秒） */
const DEFAULT_TIMEOUT = 60_000;

/** 流式请求默认超时（毫秒）—— thinking 模型可能长时间无输出，需要更长超时 */
const DEFAULT_STREAM_TIMEOUT = 600_000;

/**
 * 合并外部 AbortSignal 与超时 AbortSignal。
 *
 * 任一触发都会中止请求：
 * - 超时触发 → AbortError
 * - 外部 signal 触发 → AbortError（reason 由调用方决定）
 *
 * 使用 AbortSignal.any() 合并（Node 20+），不可用时降级为手动 AbortController。
 */
function combineSignals(externalSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;

  // AbortSignal.any 在 Node 20+ 可用
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([externalSignal, timeoutSignal]);
  }

  // 降级：手动 AbortController
  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal.reason);
  const onTimeout = () => controller.abort(timeoutSignal.reason);

  if (externalSignal.aborted) { controller.abort(externalSignal.reason); return controller.signal; }
  if (timeoutSignal.aborted) { controller.abort(timeoutSignal.reason); return controller.signal; }

  externalSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeout, { once: true });

  // 当合并 signal 被 abort 后，移除监听防止泄漏
  controller.signal.addEventListener('abort', () => {
    externalSignal.removeEventListener('abort', onAbort);
    timeoutSignal.removeEventListener('abort', onTimeout);
  }, { once: true });

  return controller.signal;
}

/**
 * 发送 HTTP 请求，返回原始 Response。
 *
 * @param loggingDir  日志目录。传入时启用请求/响应日志，不传则不记录。
 *                    每个 Provider 实例持有自己的日志目录，互不影响。
 */
export async function sendRequest(
  endpoint: EndpointConfig,
  body: unknown,
  stream: boolean,
  timeout?: number,
  signal?: AbortSignal,
  loggingDir?: string,
): Promise<Response> {
  const url = stream ? (endpoint.streamUrl ?? endpoint.url) : endpoint.url;
  const effectiveTimeout = timeout ?? (stream ? DEFAULT_STREAM_TIMEOUT : DEFAULT_TIMEOUT);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Iris',
    ...endpoint.headers,
  };

  let timestamp: string | undefined;
  if (loggingDir) {
    timestamp = logRequest(loggingDir, { url, method: 'POST', headers, body });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: combineSignals(signal, effectiveTimeout),
  });

  if (!loggingDir || !timestamp) return res;

  // 记录响应
  if (stream) {
    return wrapStreamForLogging(res, timestamp, loggingDir);
  }
  // 非流式：clone 后后台读取并记录
  const clone = res.clone();
  clone.text().then(text => logResponse(loggingDir, timestamp!, text, false)).catch(() => {});
  return res;
}

/**
 * 包装流式 Response，透传所有数据的同时收集完整响应用于日志记录。
 *
 * 使用 TransformStream 作为透明代理，流结束时将收集到的全部 SSE 文本写入文件。
 */
function wrapStreamForLogging(res: Response, timestamp: string, logsDir: string): Response {
  const body = res.body;
  if (!body) return res;

  const decoder = new TextDecoder();
  const chunks: string[] = [];

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      chunks.push(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    flush() {
      try { logResponse(logsDir, timestamp, chunks.join(''), true); } catch { /* ignore */ }
    },
  });

  return new Response(body.pipeThrough(transform), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
