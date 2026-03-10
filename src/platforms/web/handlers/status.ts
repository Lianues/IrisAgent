/**
 * 状态 API 处理器
 *
 * GET /api/status — 返回系统状态信息
 */

import * as http from 'http';
import { sendJSON } from '../router';

export interface StatusInfo {
  provider: string;
  model: string;
  tools: string[];
  stream: boolean;
  platform: string;
}

export function createStatusHandler(info: StatusInfo) {
  return async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    sendJSON(res, 200, info);
  };
}
