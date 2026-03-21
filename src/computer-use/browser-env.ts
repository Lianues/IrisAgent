/**
 * 浏览器执行环境（Sidecar 模式）
 *
 * Playwright 运行在独立的 Node.js 子进程（browser-sidecar.ts）中，
 * 主进程通过 stdin/stdout NDJSON 与其通信。
 * 这样主进程无论跑在 Bun 还是 Node.js 都不受影响。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../logger';
import type { Computer, EnvState } from './types';

const logger = createLogger('ComputerUse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BrowserEnvConfig {
  screenWidth: number;
  screenHeight: number;
  headless?: boolean;
  initialUrl?: string;
  searchEngineUrl?: string;
  highlightMouse?: boolean;
}

export class BrowserEnvironment implements Computer {
  private _config: BrowserEnvConfig;
  private _screenSize: [number, number];
  screenDescription: string;
  private _child: ChildProcess | null = null;
  private _rl: readline.Interface | null = null;
  private _nextId = 1;
  private _pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(config: BrowserEnvConfig) {
    this._config = config;
    this._screenSize = [config.screenWidth, config.screenHeight];
    this.screenDescription = `浏览器 (${config.screenWidth}×${config.screenHeight})`;
  }

  screenSize(): [number, number] {
    return this._screenSize;
  }

  async initialize(): Promise<void> {
    logger.info('正在启动 sidecar 子进程...');

    const sidecarPath = path.resolve(__dirname, 'browser-sidecar.ts');

    // 用 node + tsx loader 启动 sidecar，确保始终在 Node.js 中运行
    this._child = spawn('node', ['--import', 'tsx', sidecarPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    // 监听 stdout 上的 NDJSON 响应
    this._rl = readline.createInterface({ input: this._child.stdout! });
    this._rl.on('line', (line) => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; }
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });

    // 子进程异常退出时拒绝所有待处理的请求
    this._child.on('exit', (code) => {
      for (const [, { reject }] of this._pending) {
        reject(new Error(`sidecar 进程退出 (code=${code})`));
      }
      this._pending.clear();
    });

    // 发送 initialize 指令
    const result = await this._call('initialize', {
      screenWidth: this._config.screenWidth,
      screenHeight: this._config.screenHeight,
      headless: this._config.headless,
      initialUrl: this._config.initialUrl,
      searchEngineUrl: this._config.searchEngineUrl,
      highlightMouse: this._config.highlightMouse,
    });

    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this._call('dispose');
    } catch { /* sidecar 可能已退出 */ }
    if (this._child) {
      this._child.stdin?.end();
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this._child?.kill(); resolve(); }, 5000);
        this._child!.on('exit', () => { clearTimeout(timer); resolve(); });
      });
      this._child = null;
    }
  }

  // ============ Computer 接口 ============

  async currentState(): Promise<EnvState> {
    return this._callEnv('currentState');
  }

  async openWebBrowser(): Promise<EnvState> {
    return this._callEnv('openWebBrowser');
  }

  async goBack(): Promise<EnvState> {
    return this._callEnv('goBack');
  }

  async goForward(): Promise<EnvState> {
    return this._callEnv('goForward');
  }

  async search(): Promise<EnvState> {
    return this._callEnv('search', { searchEngineUrl: this._config.searchEngineUrl });
  }

  async navigate(url: string): Promise<EnvState> {
    return this._callEnv('navigate', { url });
  }

  async clickAt(x: number, y: number): Promise<EnvState> {
    return this._callEnv('clickAt', { x, y });
  }

  async hoverAt(x: number, y: number): Promise<EnvState> {
    return this._callEnv('hoverAt', { x, y });
  }

  async dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<EnvState> {
    return this._callEnv('dragAndDrop', { x, y, destX, destY });
  }

  async typeTextAt(x: number, y: number, text: string, pressEnter: boolean, clearBeforeTyping: boolean): Promise<EnvState> {
    return this._callEnv('typeTextAt', { x, y, text, pressEnter, clearBeforeTyping });
  }

  async keyCombination(keys: string[]): Promise<EnvState> {
    return this._callEnv('keyCombination', { keys });
  }

  async scrollDocument(direction: 'up' | 'down' | 'left' | 'right'): Promise<EnvState> {
    return this._callEnv('scrollDocument', { direction });
  }

  async scrollAt(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', magnitude: number): Promise<EnvState> {
    return this._callEnv('scrollAt', { x, y, direction, magnitude });
  }

  async wait5Seconds(): Promise<EnvState> {
    return this._callEnv('wait5Seconds');
  }

  // ============ 内部 IPC ============

  /** 调用 sidecar 方法并将结果转为 EnvState */
  private async _callEnv(method: string, params?: Record<string, unknown>): Promise<EnvState> {
    const result = await this._call(method, params);
    return {
      screenshot: Buffer.from(result.screenshot as string, 'base64'),
      url: result.url as string,
    };
  }

  /** 发送 IPC 请求并等待响应 */
  private _call(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this._child?.stdin) {
      return Promise.reject(new Error('sidecar 未启动'));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, method, params: params ?? {} }) + '\n';
      this._child!.stdin!.write(msg);
    });
  }
}
