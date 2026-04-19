import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildBashPromptEnvironment, buildPowerShellPromptBootstrapCommand, buildZshRcContent, consumeMarkers } from './protocol.js';
import { normalizeDisplayLines, stripAnsi, truncateMiddle } from './snapshot.js';
import { resolveTerminalShell } from './shell-resolver.js';
import type {
  ExecCommandResult,
  MarkerInfo,
  SidecarInitializeParams,
  TerminalShellKind,
  TerminalState,
} from './types.js';
import * as path from 'node:path';

function log(message: string): void {
  process.stderr.write(`[terminal-use:sidecar] ${message}\n`);
}

function send(message: { id: number; result?: unknown; error?: string }): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('按键不能为空');

  const normalized = trimmed.toLowerCase().replace(/\s+/g, '');
  const parts = normalized.split('+').filter(Boolean);
  const base = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));

  const plainMap: Record<string, string> = {
    enter: '\r',
    return: '\r',
    tab: '\t',
    backspace: '\x7f',
    delete: '\x1b[3~',
    escape: '\x1b',
    esc: '\x1b',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    home: '\x1b[H',
    end: '\x1b[F',
    pageup: '\x1b[5~',
    pagedown: '\x1b[6~',
    space: ' ',
  };

  if (modifiers.size === 0) {
    return plainMap[base] ?? trimmed;
  }

  if (modifiers.size === 1 && modifiers.has('shift') && base === 'tab') {
    return '\x1b[Z';
  }

  if (modifiers.size === 1 && modifiers.has('ctrl')) {
    if (base === 'c') return '\x03';
    if (base === 'd') return '\x04';
    if (base === 'z') return '\x1a';
    if (base === 'l') return '\x0c';
    if (base.length === 1 && /[a-z]/.test(base)) {
      return String.fromCharCode(base.toUpperCase().charCodeAt(0) - 64);
    }
  }

  if (modifiers.size === 1 && modifiers.has('alt')) {
    return `\x1b${plainMap[base] ?? base}`;
  }

  throw new Error(`暂不支持的按键组合: ${key}`);
}

function prepareShellLaunch(
  shell: { command: string; args: string[]; kind: TerminalShellKind },
  baseEnv: Record<string, string | undefined>,
): { args: string[]; env: Record<string, string | undefined>; cleanupDir?: string } {
  if (shell.kind === 'powershell') {
    return {
      args: [...shell.args, '-NoExit', '-Command', buildPowerShellPromptBootstrapCommand()],
      env: baseEnv,
    };
  }

  if (shell.kind === 'zsh') {
    const bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-terminal-use-zsh-'));
    fs.writeFileSync(path.join(bootstrapDir, '.zshrc'), buildZshRcContent(), 'utf8');
    return {
      args: shell.args,
      env: {
        ...baseEnv,
        ZDOTDIR: bootstrapDir,
      },
      cleanupDir: bootstrapDir,
    };
  }

  return {
    args: shell.args,
    env: buildBashPromptEnvironment(baseEnv),
  };
}

interface PendingExec {
  capture: string;
  resolve: (value: { marker: MarkerInfo; capture: string }) => void;
}

class TerminalRuntime {
  private ptyProcess: any = null;
  private term: any = null;
  private cols = 120;
  private rows = 32;
  private scrollback = 5000;
  private maxDisplayChars = 12_000;
  private maxCommandOutputChars = 50_000;
  private idleQuietMs = 350;
  private shellKind: TerminalShellKind = process.platform === 'win32' ? 'powershell' : 'bash';
  private cwd: string | undefined;
  private promptReady = true;
  private lastExitCode: number | undefined;
  private viewOffset = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private lastOutputAt = Date.now();
  private markerCarry = '';
  private outputSeq = 0;
  private outputHistory: Array<{ id: number; data: string }> = [];
  private outputHistoryChars = 0;
  private pendingExec: PendingExec | null = null;
  private shellBootstrapDir: string | undefined;

  async initialize(params: SidecarInitializeParams): Promise<TerminalState> {
    if (this.ptyProcess) {
      return this.snapshot(false);
    }

    const [{ Terminal }, pty] = await Promise.all([
      import('@xterm/headless'),
      import('node-pty'),
    ]);

    this.cols = params.cols;
    this.rows = params.rows;
    this.scrollback = params.scrollback;
    this.maxDisplayChars = params.maxDisplayChars;
    this.maxCommandOutputChars = params.maxCommandOutputChars;
    this.idleQuietMs = params.idleQuietMs;
    this.cwd = params.cwd;
    this.lastOutputAt = Date.now();

    const shell = resolveTerminalShell(params.shell);
    this.shellKind = shell.kind;

    const launch = prepareShellLaunch(shell, {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    });
    this.shellBootstrapDir = launch.cleanupDir;

    this.term = new Terminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      allowProposedApi: true,
    });

    this.ptyProcess = pty.spawn(shell.command, launch.args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: params.cwd,
      env: launch.env,
    });

    this.ptyProcess.onData((data: string) => {
      this.handleData(data);
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      log(`PTY 已退出 (code=${exitCode})`);
      this.promptReady = false;
      this.lastExitCode = exitCode;
      this.ptyProcess = null;
    });

    await this.waitForQuiet(params.startupTimeoutMs, this.idleQuietMs);
    return this.snapshot(false);
  }

  async dispose(): Promise<{ ok: true }> {
    try {
      this.ptyProcess?.kill();
    } catch {
      // ignore
    }
    this.ptyProcess = null;
    try {
      this.term?.dispose?.();
    } catch {
      // ignore
    }
    this.term = null;
    this.pendingExec = null;
    if (this.shellBootstrapDir) {
      try {
        fs.rmSync(this.shellBootstrapDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.shellBootstrapDir = undefined;
    }
    return { ok: true };
  }

  async snapshot(resetScroll: boolean = false): Promise<TerminalState> {
    this.ensureReady();
    if (resetScroll) this.viewOffset = 0;
    return this.buildState();
  }

  async execCommand(command: string, timeoutMs: number): Promise<ExecCommandResult> {
    this.ensureReady();
    if (this.pendingExec) {
      throw new Error('已有命令正在执行，请先等待完成或调用 interrupt_terminal');
    }

    this.viewOffset = 0;
    this.promptReady = false;

    const donePromise = new Promise<{ marker: MarkerInfo; capture: string }>((resolve) => {
      this.pendingExec = {
        capture: '',
        resolve,
      };
    });

    this.ptyProcess.write(command + '\r');

    const raced = await Promise.race([
      donePromise.then(value => ({ type: 'done' as const, value })),
      sleep(timeoutMs).then(() => ({ type: 'timeout' as const })),
    ]);

    if (raced.type === 'timeout') {
      const partialCapture = this.pendingExec?.capture ?? '';
      const commandOutput = truncateMiddle(stripAnsi(partialCapture), this.maxCommandOutputChars);
      const state = await this.buildExecState(command, {
        commandOutput: commandOutput.text,
        timedOut: true,
        truncated: commandOutput.truncated ? { commandOutput: true } : undefined,
        exitCode: this.lastExitCode,
        promptReady: false,
      });
      return state as ExecCommandResult;
    }

    const { marker, capture } = raced.value;
    const commandOutput = truncateMiddle(stripAnsi(capture), this.maxCommandOutputChars);
    const state = await this.buildExecState(command, {
      commandOutput: commandOutput.text,
      exitCode: marker.exitCode,
      cwd: marker.cwd ?? this.cwd,
      promptReady: true,
      truncated: commandOutput.truncated ? { commandOutput: true } : undefined,
    });
    return state as ExecCommandResult;
  }

  async typeText(text: string, timeoutMs?: number): Promise<TerminalState> {
    this.ensureReady();
    const startSeq = this.outputSeq;
    this.ptyProcess.write(text);
    await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 2, 800), this.idleQuietMs);
    return this.buildStateWithOutput(startSeq);
  }

  async pressKey(key: string, timeoutMs?: number): Promise<TerminalState> {
    this.ensureReady();
    const startSeq = this.outputSeq;
    const encoded = encodeKey(key);
    if (/^(enter|return)$/i.test(key.trim()) && !this.pendingExec) {
      this.promptReady = false;
    }
    this.ptyProcess.write(encoded);
    await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 2, 800), this.idleQuietMs);
    return this.buildStateWithOutput(startSeq);
  }

  async scroll(direction: 'up' | 'down', lines?: number): Promise<TerminalState> {
    this.ensureReady();
    const step = Math.max(1, Math.floor(lines ?? Math.max(3, this.rows / 2)));
    const maxOffset = this.getMaxScrollOffset();
    if (direction === 'up') {
      this.viewOffset = Math.min(maxOffset, this.viewOffset + step);
    } else {
      this.viewOffset = Math.max(0, this.viewOffset - step);
    }
    return this.buildState();
  }

  async wait(milliseconds?: number, untilIdle?: boolean, timeoutMs?: number): Promise<TerminalState> {
    this.ensureReady();
    const startSeq = this.outputSeq;
    if (untilIdle) {
      await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 3, 1500), this.idleQuietMs);
    } else {
      await sleep(Math.max(0, milliseconds ?? 1000));
    }
    return this.buildStateWithOutput(startSeq);
  }

  async interrupt(timeoutMs?: number): Promise<TerminalState> {
    this.ensureReady();
    const startSeq = this.outputSeq;
    this.ptyProcess.write('\x03');
    if (this.pendingExec) {
      this.pendingExec = null;
      this.promptReady = true;
      this.lastExitCode = 130;
    }
    await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 3, 1500), this.idleQuietMs);
    const state = await this.buildStateWithOutput(startSeq, this.lastExitCode);
    if (!state.output) {
      state.output = '^C';
    }
    return state;
  }

  private handleData(data: string): void {
    this.lastOutputAt = Date.now();
    this.viewOffset = 0;

    const { clean, carry, markers } = consumeMarkers(this.markerCarry, data);
    this.markerCarry = carry;

    if (clean) {
      this.appendHistory(clean);
      if (this.pendingExec) {
        this.pendingExec.capture += clean;
      }
      this.enqueueWrite(clean);
    }

    for (const marker of markers) {
      this.promptReady = true;
      this.lastExitCode = marker.exitCode;
      if (marker.cwd) this.cwd = marker.cwd;
      if (this.pendingExec) {
        const finished = this.pendingExec;
        this.pendingExec = null;
        finished.resolve({ marker, capture: finished.capture });
      }
    }
  }

  private appendHistory(data: string): void {
    this.outputSeq += 1;
    this.outputHistory.push({ id: this.outputSeq, data });
    this.outputHistoryChars += data.length;
    while (this.outputHistory.length > 0 && this.outputHistoryChars > 200_000) {
      const removed = this.outputHistory.shift();
      this.outputHistoryChars -= removed?.data.length ?? 0;
    }
  }

  private captureSince(sequence: number): string {
    if (this.outputHistory.length === 0) return '';
    return this.outputHistory
      .filter(item => item.id > sequence)
      .map(item => item.data)
      .join('');
  }

  private enqueueWrite(data: string): void {
    if (!data || !this.term) return;
    this.writeChain = this.writeChain
      .then(() => new Promise<void>((resolve) => {
        try {
          this.term.write(data, () => resolve());
        } catch {
          resolve();
        }
      }))
      .catch(() => {});
  }

  private async flushWrites(): Promise<void> {
    await this.writeChain;
  }

  private ensureReady(): void {
    if (!this.ptyProcess || !this.term) {
      throw new Error('terminal 会话尚未初始化或已退出');
    }
  }

  private async waitForQuiet(timeoutMs: number, quietMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const stableWindow = Math.max(50, quietMs);
    while (Date.now() < deadline) {
      if (Date.now() - this.lastOutputAt >= stableWindow) return;
      await sleep(Math.min(stableWindow, Math.max(25, deadline - Date.now())));
    }
  }

  private getMaxScrollOffset(): number {
    const buffer = this.term?.buffer?.active as any;
    const length = typeof buffer?.length === 'number' ? buffer.length : this.rows;
    return Math.max(0, length - this.rows);
  }

  private async buildStateWithOutput(startSeq: number, exitCode?: number): Promise<TerminalState> {
    const outputRaw = stripAnsi(this.captureSince(startSeq));
    const output = truncateMiddle(outputRaw, this.maxCommandOutputChars);
    return this.buildState({
      output: output.text || undefined,
      exitCode,
      truncated: output.truncated ? { output: true } : undefined,
    });
  }

  private async buildState(extra: Partial<TerminalState> = {}): Promise<TerminalState> {
    await this.flushWrites();

    const buffer = this.term?.buffer?.active as any;
    const length = typeof buffer?.length === 'number' ? buffer.length : this.rows;
    const maxOffset = Math.max(0, length - this.rows);
    this.viewOffset = Math.min(this.viewOffset, maxOffset);
    const start = Math.max(0, length - this.rows - this.viewOffset);

    const lines: string[] = [];
    for (let i = 0; i < this.rows; i++) {
      const line = buffer?.getLine?.(start + i);
      lines.push(typeof line?.translateToString === 'function' ? line.translateToString(true) : '');
    }

    const displayRaw = normalizeDisplayLines(lines);
    const display = truncateMiddle(displayRaw, this.maxDisplayChars);

    const state: TerminalState = {
      display: display.text,
      rows: this.rows,
      cols: this.cols,
      cursorRow: typeof buffer?.cursorY === 'number' ? buffer.cursorY : 0,
      cursorCol: typeof buffer?.cursorX === 'number' ? buffer.cursorX : 0,
      promptReady: extra.promptReady ?? (this.pendingExec ? false : this.promptReady),
      altScreen: Boolean(buffer?.type === 'alternate'),
      shellKind: this.shellKind,
      cwd: extra.cwd ?? this.cwd,
      output: extra.output,
      commandOutput: extra.commandOutput,
      exitCode: extra.exitCode ?? this.lastExitCode,
      timedOut: extra.timedOut,
      scrollback: {
        offset: this.viewOffset,
        maxOffset,
      },
    };

    const truncated = {
      ...(display.truncated ? { display: true } : {}),
      ...(extra.truncated ?? {}),
    };
    if (Object.keys(truncated).length > 0) {
      state.truncated = truncated;
    }
    return state;
  }

  private async buildExecState(command: string, extra: Partial<TerminalState> = {}): Promise<ExecCommandResult> {
    const state = await this.buildState(extra);
    return { ...state, command };
  }
}

const runtime = new TerminalRuntime();

async function handleRequest(request: { id: number; method: string; params?: Record<string, unknown> }): Promise<void> {
  try {
    const params = request.params ?? {};
    let result: unknown;

    switch (request.method) {
      case 'initialize':
        result = await runtime.initialize(params as SidecarInitializeParams);
        break;
      case 'dispose':
        result = await runtime.dispose();
        break;
      case 'snapshot':
        result = await runtime.snapshot(Boolean(params.resetScroll));
        break;
      case 'execCommand':
        result = await runtime.execCommand(String(params.command ?? ''), Number(params.timeoutMs ?? 30_000));
        break;
      case 'typeText':
        result = await runtime.typeText(String(params.text ?? ''), typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined);
        break;
      case 'pressKey':
        result = await runtime.pressKey(String(params.key ?? ''), typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined);
        break;
      case 'scroll': {
        const direction = params.direction === 'up' ? 'up' : 'down';
        result = await runtime.scroll(direction, typeof params.lines === 'number' ? params.lines : undefined);
        break;
      }
      case 'wait':
        result = await runtime.wait(
          typeof params.milliseconds === 'number' ? params.milliseconds : undefined,
          params.untilIdle === true,
          typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined,
        );
        break;
      case 'interrupt':
        result = await runtime.interrupt(typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined);
        break;
      default:
        throw new Error(`未知方法: ${request.method}`);
    }

    send({ id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ id: request.id, error: message });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let request: { id: number; method: string; params?: Record<string, unknown> };
  try {
    request = JSON.parse(line);
  } catch (error) {
    log(`忽略无效 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  void handleRequest(request);
});

rl.on('close', async () => {
  try {
    await runtime.dispose();
  } catch {
    // ignore
  }
  process.exit(0);
});

log('terminal-use sidecar 已启动');
