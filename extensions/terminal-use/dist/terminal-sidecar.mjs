import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/terminal-sidecar.ts
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as os from "node:os";

// src/protocol.ts
var OSC_MARKER_PREFIX = "\x1B]1337;IRIS_DONE=";
var OSC_MARKER_REGEX = /\u001b\]1337;IRIS_DONE=([^;\u0007\u001b]+);([^\u0007\u001b\\]*)(?:\u0007|\u001b\\)/g;
var BASH_PROMPT_COMMAND = `__iris_ec=$?; __iris_cwd_b64=$(printf '%s' "$PWD" | base64 | tr -d '\\r\\n'); printf '\\033]1337;IRIS_DONE=%s;%s\\007' "$__iris_ec" "$__iris_cwd_b64"`;
function decodeBase64Utf8(value) {
  if (!value)
    return;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return;
  }
}
function consumeMarkers(previousCarry, chunk) {
  const combined = previousCarry + chunk;
  const lastStart = combined.lastIndexOf(OSC_MARKER_PREFIX);
  let processable = combined;
  let carry = "";
  if (lastStart >= 0) {
    const tail = combined.slice(lastStart);
    if (!tail.includes("\x07") && !tail.includes("\x1B\\")) {
      processable = combined.slice(0, lastStart);
      carry = tail;
    }
  }
  const markers = [];
  const clean = processable.replace(OSC_MARKER_REGEX, (_full, exitCode, cwdB64) => {
    markers.push({
      exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0,
      cwd: decodeBase64Utf8(cwdB64)
    });
    return "";
  });
  return { clean, carry, markers };
}
function buildPowerShellPromptBootstrapCommand() {
  return [
    "function global:prompt {",
    "  $__irisSuccess = $?;",
    "  $__irisLastExit = $global:LASTEXITCODE;",
    "  $__irisCwd = (Get-Location).Path;",
    "  $__irisCwdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($__irisCwd));",
    "  $__irisExit = if ($null -ne $__irisLastExit) { [int]$__irisLastExit } elseif ($__irisSuccess) { 0 } else { 1 };",
    '  [Console]::Out.Write(([string][char]27) + "]1337;IRIS_DONE=$($__irisExit);$($__irisCwdB64)" + ([string][char]7));',
    '  "PS $($__irisCwd)> "',
    "}"
  ].join(" ");
}
function buildBashPromptEnvironment(baseEnv) {
  return {
    ...baseEnv,
    PROMPT_COMMAND: BASH_PROMPT_COMMAND,
    PS1: "\\w\\$ "
  };
}
function buildZshRcContent() {
  return [
    "setopt PROMPT_PERCENT",
    "HISTFILE=/dev/null",
    "HISTSIZE=0",
    "SAVEHIST=0",
    "function __iris_precmd_hook() {",
    "  local __iris_exit=$?",
    "  local __iris_cwd_b64",
    '  __iris_cwd_b64=$(printf "%s" "$PWD" | base64 | tr -d "\\r\\n")',
    '  printf "\\033]1337;IRIS_DONE=%s;%s\\007" "$__iris_exit" "$__iris_cwd_b64"',
    "}",
    "autoload -Uz add-zsh-hook",
    "add-zsh-hook precmd __iris_precmd_hook",
    'PROMPT="%~%# "',
    'RPROMPT=""'
  ].join(`
`);
}

// src/snapshot.ts
function truncateMiddle(text, maxChars) {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false };
  }
  const marker = `

... (已截断，共 ${text.length} 字符) ...

`;
  if (marker.length >= maxChars) {
    return { text: text.slice(0, maxChars), truncated: true };
  }
  const keep = Math.floor((maxChars - marker.length) / 2);
  const head = text.slice(0, keep);
  const tail = text.slice(text.length - keep);
  return { text: head + marker + tail, truncated: true };
}
function stripAnsi(text) {
  return text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "").replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, "").replace(/\r/g, "");
}
function normalizeDisplayLines(lines) {
  const normalized = lines.map((line) => line.replace(/\s+$/g, ""));
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  return normalized.join(`
`);
}

// src/shell-resolver.ts
import { execFileSync } from "node:child_process";
import * as path from "node:path";
function inferShellKind(command) {
  const base = path.basename(command).toLowerCase();
  if (base.includes("pwsh") || base.includes("powershell"))
    return "powershell";
  if (base.includes("zsh"))
    return "zsh";
  if (base.includes("bash") || base.includes("sh"))
    return "bash";
  return process.platform === "win32" ? "powershell" : "bash";
}
function commandExists(command, args) {
  try {
    execFileSync(command, args, {
      stdio: "ignore",
      timeout: 3000,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
function resolveTerminalShell(requestedShell) {
  if (requestedShell) {
    const kind = inferShellKind(requestedShell);
    const base = path.basename(requestedShell).toLowerCase();
    return {
      command: requestedShell,
      args: kind === "powershell" ? ["-NoLogo", "-NoProfile"] : kind === "zsh" || base.includes("zsh") ? ["-i"] : ["--noprofile", "--norc", "-i"],
      displayName: requestedShell,
      kind
    };
  }
  if (process.platform === "win32") {
    if (commandExists("pwsh.exe", ["-NoLogo", "-NoProfile", "-Command", "exit 0"])) {
      return {
        command: "pwsh.exe",
        args: ["-NoLogo", "-NoProfile"],
        displayName: "PowerShell 7+",
        kind: "powershell"
      };
    }
    if (commandExists("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", "exit 0"])) {
      return {
        command: "powershell.exe",
        args: ["-NoLogo", "-NoProfile"],
        displayName: "Windows PowerShell",
        kind: "powershell"
      };
    }
    if (commandExists("bash.exe", ["-lc", "exit 0"])) {
      return {
        command: "bash.exe",
        args: ["--noprofile", "--norc", "-i"],
        displayName: "bash",
        kind: "bash"
      };
    }
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile"],
      displayName: "Windows PowerShell",
      kind: "powershell"
    };
  }
  if (commandExists("bash", ["-lc", "exit 0"])) {
    return {
      command: "bash",
      args: ["--noprofile", "--norc", "-i"],
      displayName: "bash",
      kind: "bash"
    };
  }
  const shell = process.env.SHELL?.trim();
  if (shell) {
    const base = path.basename(shell).toLowerCase();
    return {
      command: shell,
      args: inferShellKind(shell) === "powershell" ? ["-NoLogo", "-NoProfile"] : inferShellKind(shell) === "zsh" || base.includes("zsh") ? ["-i"] : ["--noprofile", "--norc", "-i"],
      displayName: shell,
      kind: inferShellKind(shell)
    };
  }
  return {
    command: "/bin/bash",
    args: ["--noprofile", "--norc", "-i"],
    displayName: "/bin/bash",
    kind: "bash"
  };
}

// src/terminal-sidecar.ts
import * as path2 from "node:path";
function log(message) {
  process.stderr.write(`[terminal-use:sidecar] ${message}
`);
}
function send(message) {
  process.stdout.write(JSON.stringify(message) + `
`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function encodeKey(key) {
  const trimmed = key.trim();
  if (!trimmed)
    throw new Error("按键不能为空");
  const normalized = trimmed.toLowerCase().replace(/\s+/g, "");
  const parts = normalized.split("+").filter(Boolean);
  const base = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  const plainMap = {
    enter: "\r",
    return: "\r",
    tab: "\t",
    backspace: "",
    delete: "\x1B[3~",
    escape: "\x1B",
    esc: "\x1B",
    up: "\x1B[A",
    down: "\x1B[B",
    right: "\x1B[C",
    left: "\x1B[D",
    home: "\x1B[H",
    end: "\x1B[F",
    pageup: "\x1B[5~",
    pagedown: "\x1B[6~",
    space: " "
  };
  if (modifiers.size === 0) {
    return plainMap[base] ?? trimmed;
  }
  if (modifiers.size === 1 && modifiers.has("shift") && base === "tab") {
    return "\x1B[Z";
  }
  if (modifiers.size === 1 && modifiers.has("ctrl")) {
    if (base === "c")
      return "\x03";
    if (base === "d")
      return "\x04";
    if (base === "z")
      return "\x1A";
    if (base === "l")
      return "\f";
    if (base.length === 1 && /[a-z]/.test(base)) {
      return String.fromCharCode(base.toUpperCase().charCodeAt(0) - 64);
    }
  }
  if (modifiers.size === 1 && modifiers.has("alt")) {
    return `\x1B${plainMap[base] ?? base}`;
  }
  throw new Error(`暂不支持的按键组合: ${key}`);
}
function prepareShellLaunch(shell, baseEnv) {
  if (shell.kind === "powershell") {
    return {
      args: [...shell.args, "-NoExit", "-Command", buildPowerShellPromptBootstrapCommand()],
      env: baseEnv
    };
  }
  if (shell.kind === "zsh") {
    const bootstrapDir = fs.mkdtempSync(path2.join(os.tmpdir(), "iris-terminal-use-zsh-"));
    fs.writeFileSync(path2.join(bootstrapDir, ".zshrc"), buildZshRcContent(), "utf8");
    return {
      args: shell.args,
      env: {
        ...baseEnv,
        ZDOTDIR: bootstrapDir
      },
      cleanupDir: bootstrapDir
    };
  }
  return {
    args: shell.args,
    env: buildBashPromptEnvironment(baseEnv)
  };
}

class TerminalRuntime {
  ptyProcess = null;
  term = null;
  cols = 120;
  rows = 32;
  scrollback = 5000;
  maxDisplayChars = 12000;
  maxCommandOutputChars = 50000;
  idleQuietMs = 350;
  shellKind = process.platform === "win32" ? "powershell" : "bash";
  cwd;
  promptReady = true;
  lastExitCode;
  viewOffset = 0;
  writeChain = Promise.resolve();
  lastOutputAt = Date.now();
  markerCarry = "";
  outputSeq = 0;
  outputHistory = [];
  outputHistoryChars = 0;
  pendingExec = null;
  shellBootstrapDir;
  async initialize(params) {
    if (this.ptyProcess) {
      return this.snapshot(false);
    }
    const [{ Terminal }, pty] = await Promise.all([
      import("@xterm/headless"),
      import("node-pty")
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
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8"
    });
    this.shellBootstrapDir = launch.cleanupDir;
    this.term = new Terminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      allowProposedApi: true
    });
    this.ptyProcess = pty.spawn(shell.command, launch.args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: params.cwd,
      env: launch.env
    });
    this.ptyProcess.onData((data) => {
      this.handleData(data);
    });
    this.ptyProcess.onExit(({ exitCode }) => {
      log(`PTY 已退出 (code=${exitCode})`);
      this.promptReady = false;
      this.lastExitCode = exitCode;
      this.ptyProcess = null;
    });
    await this.waitForQuiet(params.startupTimeoutMs, this.idleQuietMs);
    return this.snapshot(false);
  }
  async dispose() {
    try {
      this.ptyProcess?.kill();
    } catch {}
    this.ptyProcess = null;
    try {
      this.term?.dispose?.();
    } catch {}
    this.term = null;
    this.pendingExec = null;
    if (this.shellBootstrapDir) {
      try {
        fs.rmSync(this.shellBootstrapDir, { recursive: true, force: true });
      } catch {}
      this.shellBootstrapDir = undefined;
    }
    return { ok: true };
  }
  async snapshot(resetScroll = false) {
    this.ensureReady();
    if (resetScroll)
      this.viewOffset = 0;
    return this.buildState();
  }
  async execCommand(command, timeoutMs) {
    this.ensureReady();
    if (this.pendingExec) {
      throw new Error("已有命令正在执行，请先等待完成或调用 interrupt_terminal");
    }
    this.viewOffset = 0;
    this.promptReady = false;
    const donePromise = new Promise((resolve) => {
      this.pendingExec = {
        capture: "",
        resolve
      };
    });
    this.ptyProcess.write(command + "\r");
    const raced = await Promise.race([
      donePromise.then((value) => ({ type: "done", value })),
      sleep(timeoutMs).then(() => ({ type: "timeout" }))
    ]);
    if (raced.type === "timeout") {
      const partialCapture = this.pendingExec?.capture ?? "";
      const commandOutput2 = truncateMiddle(stripAnsi(partialCapture), this.maxCommandOutputChars);
      const state2 = await this.buildExecState(command, {
        commandOutput: commandOutput2.text,
        timedOut: true,
        truncated: commandOutput2.truncated ? { commandOutput: true } : undefined,
        exitCode: this.lastExitCode,
        promptReady: false
      });
      return state2;
    }
    const { marker, capture } = raced.value;
    const commandOutput = truncateMiddle(stripAnsi(capture), this.maxCommandOutputChars);
    const state = await this.buildExecState(command, {
      commandOutput: commandOutput.text,
      exitCode: marker.exitCode,
      cwd: marker.cwd ?? this.cwd,
      promptReady: true,
      truncated: commandOutput.truncated ? { commandOutput: true } : undefined
    });
    return state;
  }
  async typeText(text, timeoutMs) {
    this.ensureReady();
    const startSeq = this.outputSeq;
    this.ptyProcess.write(text);
    await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 2, 800), this.idleQuietMs);
    return this.buildStateWithOutput(startSeq);
  }
  async pressKey(key, timeoutMs) {
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
  async scroll(direction, lines) {
    this.ensureReady();
    const step = Math.max(1, Math.floor(lines ?? Math.max(3, this.rows / 2)));
    const maxOffset = this.getMaxScrollOffset();
    if (direction === "up") {
      this.viewOffset = Math.min(maxOffset, this.viewOffset + step);
    } else {
      this.viewOffset = Math.max(0, this.viewOffset - step);
    }
    return this.buildState();
  }
  async wait(milliseconds, untilIdle, timeoutMs) {
    this.ensureReady();
    const startSeq = this.outputSeq;
    if (untilIdle) {
      await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 3, 1500), this.idleQuietMs);
    } else {
      await sleep(Math.max(0, milliseconds ?? 1000));
    }
    return this.buildStateWithOutput(startSeq);
  }
  async interrupt(timeoutMs) {
    this.ensureReady();
    const startSeq = this.outputSeq;
    this.ptyProcess.write("\x03");
    if (this.pendingExec) {
      this.pendingExec = null;
      this.promptReady = true;
      this.lastExitCode = 130;
    }
    await this.waitForQuiet(timeoutMs ?? Math.max(this.idleQuietMs * 3, 1500), this.idleQuietMs);
    const state = await this.buildStateWithOutput(startSeq, this.lastExitCode);
    if (!state.output) {
      state.output = "^C";
    }
    return state;
  }
  handleData(data) {
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
      if (marker.cwd)
        this.cwd = marker.cwd;
      if (this.pendingExec) {
        const finished = this.pendingExec;
        this.pendingExec = null;
        finished.resolve({ marker, capture: finished.capture });
      }
    }
  }
  appendHistory(data) {
    this.outputSeq += 1;
    this.outputHistory.push({ id: this.outputSeq, data });
    this.outputHistoryChars += data.length;
    while (this.outputHistory.length > 0 && this.outputHistoryChars > 200000) {
      const removed = this.outputHistory.shift();
      this.outputHistoryChars -= removed?.data.length ?? 0;
    }
  }
  captureSince(sequence) {
    if (this.outputHistory.length === 0)
      return "";
    return this.outputHistory.filter((item) => item.id > sequence).map((item) => item.data).join("");
  }
  enqueueWrite(data) {
    if (!data || !this.term)
      return;
    this.writeChain = this.writeChain.then(() => new Promise((resolve) => {
      try {
        this.term.write(data, () => resolve());
      } catch {
        resolve();
      }
    })).catch(() => {});
  }
  async flushWrites() {
    await this.writeChain;
  }
  ensureReady() {
    if (!this.ptyProcess || !this.term) {
      throw new Error("terminal 会话尚未初始化或已退出");
    }
  }
  async waitForQuiet(timeoutMs, quietMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const stableWindow = Math.max(50, quietMs);
    while (Date.now() < deadline) {
      if (Date.now() - this.lastOutputAt >= stableWindow)
        return;
      await sleep(Math.min(stableWindow, Math.max(25, deadline - Date.now())));
    }
  }
  getMaxScrollOffset() {
    const buffer = this.term?.buffer?.active;
    const length = typeof buffer?.length === "number" ? buffer.length : this.rows;
    return Math.max(0, length - this.rows);
  }
  async buildStateWithOutput(startSeq, exitCode) {
    const outputRaw = stripAnsi(this.captureSince(startSeq));
    const output = truncateMiddle(outputRaw, this.maxCommandOutputChars);
    return this.buildState({
      output: output.text || undefined,
      exitCode,
      truncated: output.truncated ? { output: true } : undefined
    });
  }
  async buildState(extra = {}) {
    await this.flushWrites();
    const buffer = this.term?.buffer?.active;
    const length = typeof buffer?.length === "number" ? buffer.length : this.rows;
    const maxOffset = Math.max(0, length - this.rows);
    this.viewOffset = Math.min(this.viewOffset, maxOffset);
    const start = Math.max(0, length - this.rows - this.viewOffset);
    const lines = [];
    for (let i = 0;i < this.rows; i++) {
      const line = buffer?.getLine?.(start + i);
      lines.push(typeof line?.translateToString === "function" ? line.translateToString(true) : "");
    }
    const displayRaw = normalizeDisplayLines(lines);
    const display = truncateMiddle(displayRaw, this.maxDisplayChars);
    const state = {
      display: display.text,
      rows: this.rows,
      cols: this.cols,
      cursorRow: typeof buffer?.cursorY === "number" ? buffer.cursorY : 0,
      cursorCol: typeof buffer?.cursorX === "number" ? buffer.cursorX : 0,
      promptReady: extra.promptReady ?? (this.pendingExec ? false : this.promptReady),
      altScreen: Boolean(buffer?.type === "alternate"),
      shellKind: this.shellKind,
      cwd: extra.cwd ?? this.cwd,
      output: extra.output,
      commandOutput: extra.commandOutput,
      exitCode: extra.exitCode ?? this.lastExitCode,
      timedOut: extra.timedOut,
      scrollback: {
        offset: this.viewOffset,
        maxOffset
      }
    };
    const truncated = {
      ...display.truncated ? { display: true } : {},
      ...extra.truncated ?? {}
    };
    if (Object.keys(truncated).length > 0) {
      state.truncated = truncated;
    }
    return state;
  }
  async buildExecState(command, extra = {}) {
    const state = await this.buildState(extra);
    return { ...state, command };
  }
}
var runtime = new TerminalRuntime;
async function handleRequest(request) {
  try {
    const params = request.params ?? {};
    let result;
    switch (request.method) {
      case "initialize":
        result = await runtime.initialize(params);
        break;
      case "dispose":
        result = await runtime.dispose();
        break;
      case "snapshot":
        result = await runtime.snapshot(Boolean(params.resetScroll));
        break;
      case "execCommand":
        result = await runtime.execCommand(String(params.command ?? ""), Number(params.timeoutMs ?? 30000));
        break;
      case "typeText":
        result = await runtime.typeText(String(params.text ?? ""), typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
        break;
      case "pressKey":
        result = await runtime.pressKey(String(params.key ?? ""), typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
        break;
      case "scroll": {
        const direction = params.direction === "up" ? "up" : "down";
        result = await runtime.scroll(direction, typeof params.lines === "number" ? params.lines : undefined);
        break;
      }
      case "wait":
        result = await runtime.wait(typeof params.milliseconds === "number" ? params.milliseconds : undefined, params.untilIdle === true, typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
        break;
      case "interrupt":
        result = await runtime.interrupt(typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
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
var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim())
    return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    log(`忽略无效 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  handleRequest(request);
});
rl.on("close", async () => {
  try {
    await runtime.dispose();
  } catch {}
  process.exit(0);
});
log("terminal-use sidecar 已启动");
