import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPluginLogger } from 'irises-extension-sdk';
import type {
  ExecCommandResult,
  SidecarInitializeParams,
  TerminalEnv,
  TerminalShellKind,
  TerminalState,
} from './types.js';

const logger = createPluginLogger('terminal-use', 'TerminalEnv');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let extensionDir: string | undefined;

export function setExtensionDir(dir: string | undefined): void {
  extensionDir = dir;
}

export class TerminalEnvironment implements TerminalEnv {
  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private initialized = false;
  shellKind?: TerminalShellKind;

  constructor(private readonly config: SidecarInitializeParams) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { cmd, args } = resolveSidecarCommand('terminal-sidecar.ts');
    logger.info(`启动 terminal-use sidecar: ${cmd} ${args.join(' ')}`);

    this.child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env },
      windowsHide: true,
    });

    this.rl = readline.createInterface({ input: this.child.stdout! });
    this.rl.on('line', (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
    });

    let stderrBuffer = '';
    this.child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
    });

    this.child.on('exit', (code) => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`terminal-use sidecar 已退出 (code=${code})${stderrBuffer ? `\n${stderrBuffer}` : ''}`));
      }
      this.pending.clear();
      this.child = null;
      this.initialized = false;
    });

    try {
      const result = await this.call('initialize', this.config, Math.max(this.config.startupTimeoutMs + 5_000, 15_000));
      this.shellKind = result.shellKind as TerminalShellKind | undefined;
      this.initialized = true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    try {
      if (this.child) {
        await this.call('dispose', undefined, 3000);
      }
    } catch {
      // ignore
    }

    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.rl?.close();
    this.rl = null;

    if (!child) return;
    child.stdin?.end();
    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // ignore
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async snapshot(resetScroll: boolean = false): Promise<TerminalState> {
    await this.initialize();
    const result = await this.call('snapshot', { resetScroll }, 10_000);
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  async execCommand(command: string, timeoutMs: number): Promise<ExecCommandResult> {
    await this.initialize();
    const result = await this.call('execCommand', { command, timeoutMs }, Math.max(timeoutMs + 5_000, 15_000));
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as ExecCommandResult;
  }

  async typeText(text: string, timeoutMs?: number): Promise<TerminalState> {
    await this.initialize();
    const result = await this.call('typeText', { text, timeoutMs }, Math.max((timeoutMs ?? 1000) + 5_000, 10_000));
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  async pressKey(key: string, timeoutMs?: number): Promise<TerminalState> {
    await this.initialize();
    const result = await this.call('pressKey', { key, timeoutMs }, Math.max((timeoutMs ?? 1000) + 5_000, 10_000));
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  async scroll(direction: 'up' | 'down', lines?: number): Promise<TerminalState> {
    await this.initialize();
    const result = await this.call('scroll', { direction, lines }, 10_000);
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  async wait(milliseconds?: number, untilIdle?: boolean, timeoutMs?: number): Promise<TerminalState> {
    await this.initialize();
    const effective = timeoutMs ?? milliseconds ?? 1000;
    const result = await this.call('wait', { milliseconds, untilIdle, timeoutMs }, Math.max(effective + 5_000, 10_000));
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  async interrupt(timeoutMs?: number): Promise<TerminalState> {
    await this.initialize();
    const result = await this.call('interrupt', { timeoutMs }, Math.max((timeoutMs ?? 1000) + 5_000, 10_000));
    this.shellKind = result.shellKind as TerminalShellKind | undefined;
    return result as TerminalState;
  }

  private call(method: string, params?: Record<string, unknown>, timeoutMs: number = 30_000): Promise<any> {
    if (!this.child?.stdin) {
      return Promise.reject(new Error('terminal-use sidecar 未启动'));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`terminal-use sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.child!.stdin!.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n');
    });
  }
}

function resolveSidecarCommand(sidecarFile: string): { cmd: string; args: string[] } {
  const devTs = path.resolve(__dirname, sidecarFile);
  if (fs.existsSync(devTs)) {
    return { cmd: 'node', args: ['--import', 'tsx', devTs] };
  }

  if (extensionDir) {
    const distMjs = path.resolve(extensionDir, 'dist', sidecarFile.replace('.ts', '.mjs'));
    if (fs.existsSync(distMjs)) {
      return { cmd: 'node', args: [distMjs] };
    }
  }

  if (process.release?.name === 'node') {
    return { cmd: process.execPath, args: [path.resolve(__dirname, sidecarFile)] };
  }

  return { cmd: 'node', args: [path.resolve(__dirname, sidecarFile)] };
}
