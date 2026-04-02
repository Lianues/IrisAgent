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

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combineSignals(signal, effectiveTimeout),
    });
  } catch (err) {
    // fetch 本身失败（网络错误、DNS 失败、超时等）—— 记录到响应日志
    if (loggingDir && timestamp) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      try { logResponse(loggingDir, timestamp, `--- FETCH ERROR ---\n${detail}`, stream); } catch { /* ignore */ }
    }
    throw err;
  }

  if (!loggingDir || !timestamp) return res;

  // 记录响应
  if (stream) {
    return wrapStreamForLogging(res, timestamp, loggingDir);
  }
  // 非流式：clone 后后台读取并记录
  const clone = res.clone();
  clone.text().then(
    text => logResponse(loggingDir, timestamp!, text, false),
    err => {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      try { logResponse(loggingDir, timestamp!, `--- RESPONSE READ ERROR ---\n${detail}`, false); } catch { /* ignore */ }
    },
  );
  return res;
}

/**
 * 包装流式 Response，透传所有数据的同时收集完整响应用于日志记录。
 *
 * 使用 ReadableStream 代理原始 body，收集完整 SSE 文本用于日志记录。
 * 与 TransformStream 不同，此方式能在流异常中断时也将已收集的部分数据（及错误信息）写入日志。
 */
function wrapStreamForLogging(res: Response, timestamp: string, logsDir: string): Response {
  const body = res.body;
  if (!body) return res;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const reader = body.getReader();

  // 预先提取响应头，出错时写入日志供排查
  const headerLines: string[] = [];
  res.headers.forEach((value, key) => { headerLines.push(`${key}: ${value}`); });

  function saveLog(error?: unknown) {
    try {
      let content = chunks.join('');
      if (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        content += `\n\n--- STREAM ERROR ---\n${detail}\n`
          + `\n--- RESPONSE HEADERS ---\n${headerLines.join('\n')}\n`;
      }
      logResponse(logsDir, timestamp, content, true);
    } catch { /* ignore */ }
  }

  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          saveLog();
          controller.close();
          return;
        }
        chunks.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (err) {
        saveLog(err);
        controller.error(err);
      }
    },
    cancel(reason) {
      saveLog(reason ?? new Error('Stream cancelled'));
      return reader.cancel(reason);
    },
  });

  return new Response(wrapped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
