// ../../packages/extension-sdk/src/logger.ts
var _logLevel = 1 /* INFO */;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= 0 /* DEBUG */)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= 1 /* INFO */)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= 2 /* WARN */)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= 3 /* ERROR */)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/src/plugin/context.ts
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/config-template.ts
var DEFAULT_CONFIG_TEMPLATE = `# terminal-use 配置
#
# 启用后，LLM 可操作一个持久化的无头终端会话。
# 每次操作后返回当前终端可见页面文本，而不是截图。
# 适合执行命令、查看输出、操作 REPL / TUI / 交互式程序。
#
# 说明：
#   - Windows 默认优先启动 pwsh / powershell
#   - Linux/macOS 默认优先使用 bash（便于稳定注入 prompt hook）
#   - 如显式指定 /bin/zsh，terminal-use 会为 zsh 注入隔离的 precmd hook
#   - 终端会话保持状态：cwd、环境变量、交互程序都会持续保留
#   - 工具审批与分类器设置位于 terminal_use_tools.yaml

# 是否启用
enabled: false

# 启动目录（相对路径基于项目根目录）
# cwd: .

# 指定 shell 可执行路径；不填则自动选择当前平台默认 shell
# 例如：
#   shell: C:\\Program Files\\PowerShell\\7\\pwsh.exe
#   shell: /bin/zsh
# shell:

# 终端尺寸
cols: 120
rows: 32

# scrollback 行数
scrollback: 5000

# 启动终端后等待首屏稳定的超时（ms）
startupTimeoutMs: 10000

# exec_terminal_command 默认超时（ms）
defaultCommandTimeoutMs: 30000

# wait_terminal 默认最长等待时间（ms）
defaultWaitTimeoutMs: 10000

# 判定“终端空闲”的静默窗口（ms）
idleQuietMs: 350

# 单次返回 display 的最大字符数（超出时中间截断）
maxDisplayChars: 12000

# 单次返回完整命令输出的最大字符数（超出时中间截断）
maxCommandOutputChars: 50000

# 发送给 LLM 时，仅保留最近 N 轮 terminal-use 的大文本快照。
# 更早的 display / output / commandOutput 会被自动剥离，以节省 token。
maxRecentSnapshots: 3
`;
var DEFAULT_TOOLS_CONFIG_TEMPLATE = `# terminal-use 工具配置
#
# 这些配置由 terminal-use 扩展自己消费，
# 不依赖宿主应用的 tools.yaml 默认模板。

getTerminalSnapshotAutoApprove: true
restartTerminalAutoApprove: false

execTerminalCommandClassifier:
  enabled: true
  confidenceThreshold: 0.8
  fallbackPolicy: deny
  timeout: 8000

typeTerminalTextAutoApprove: false
pressTerminalKeyAutoApprove: false
scrollTerminalAutoApprove: true
waitTerminalAutoApprove: true
interruptTerminalAutoApprove: false
`;

// src/config.ts
import * as path from "node:path";
var DEFAULT_TERMINAL_USE_CONFIG = {
  shell: undefined,
  cols: 120,
  rows: 32,
  scrollback: 5000,
  startupTimeoutMs: 1e4,
  defaultCommandTimeoutMs: 30000,
  defaultWaitTimeoutMs: 1e4,
  idleQuietMs: 350,
  maxDisplayChars: 12000,
  maxCommandOutputChars: 50000,
  maxRecentSnapshots: 3
};
var DEFAULT_TERMINAL_USE_TOOLS_CONFIG = {
  getTerminalSnapshotAutoApprove: true,
  restartTerminalAutoApprove: false,
  execTerminalCommandClassifier: {
    enabled: true,
    confidenceThreshold: 0.8,
    fallbackPolicy: "deny",
    timeout: 8000
  },
  typeTerminalTextAutoApprove: false,
  pressTerminalKeyAutoApprove: false,
  scrollTerminalAutoApprove: true,
  waitTerminalAutoApprove: true,
  interruptTerminalAutoApprove: false
};
function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function optionalBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function parseTerminalUseConfig(raw, projectRoot = process.cwd()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return;
  const record = raw;
  if (record.enabled !== true)
    return;
  const rawCwd = optionalString(record.cwd);
  const cwd = rawCwd ? path.isAbsolute(rawCwd) ? rawCwd : path.resolve(projectRoot, rawCwd) : projectRoot;
  return {
    enabled: true,
    cwd,
    shell: optionalString(record.shell),
    cols: positiveNumber(record.cols, DEFAULT_TERMINAL_USE_CONFIG.cols),
    rows: positiveNumber(record.rows, DEFAULT_TERMINAL_USE_CONFIG.rows),
    scrollback: positiveNumber(record.scrollback, DEFAULT_TERMINAL_USE_CONFIG.scrollback),
    startupTimeoutMs: positiveNumber(record.startupTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs),
    defaultCommandTimeoutMs: positiveNumber(record.defaultCommandTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs),
    defaultWaitTimeoutMs: positiveNumber(record.defaultWaitTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs),
    idleQuietMs: positiveNumber(record.idleQuietMs, DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs),
    maxDisplayChars: positiveNumber(record.maxDisplayChars, DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars),
    maxCommandOutputChars: positiveNumber(record.maxCommandOutputChars, DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars),
    maxRecentSnapshots: Math.max(0, positiveNumber(record.maxRecentSnapshots, DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots))
  };
}
function parseTerminalUseToolsConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_TERMINAL_USE_TOOLS_CONFIG };
  }
  const record = raw;
  const classifier = record.execTerminalCommandClassifier && typeof record.execTerminalCommandClassifier === "object" && !Array.isArray(record.execTerminalCommandClassifier) ? record.execTerminalCommandClassifier : {};
  const classifierConfig = {
    enabled: optionalBoolean(classifier.enabled, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.enabled)
  };
  const model = optionalString(classifier.model);
  if (model)
    classifierConfig.model = model;
  if (typeof classifier.confidenceThreshold === "number" && classifier.confidenceThreshold > 0 && classifier.confidenceThreshold <= 1) {
    classifierConfig.confidenceThreshold = classifier.confidenceThreshold;
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold !== undefined) {
    classifierConfig.confidenceThreshold = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold;
  }
  if (classifier.fallbackPolicy === "allow" || classifier.fallbackPolicy === "deny") {
    classifierConfig.fallbackPolicy = classifier.fallbackPolicy;
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy) {
    classifierConfig.fallbackPolicy = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy;
  }
  if (typeof classifier.timeout === "number" && classifier.timeout > 0) {
    classifierConfig.timeout = Math.floor(classifier.timeout);
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout !== undefined) {
    classifierConfig.timeout = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout;
  }
  return {
    getTerminalSnapshotAutoApprove: optionalBoolean(record.getTerminalSnapshotAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.getTerminalSnapshotAutoApprove),
    restartTerminalAutoApprove: optionalBoolean(record.restartTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.restartTerminalAutoApprove),
    execTerminalCommandClassifier: classifierConfig,
    typeTerminalTextAutoApprove: optionalBoolean(record.typeTerminalTextAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.typeTerminalTextAutoApprove),
    pressTerminalKeyAutoApprove: optionalBoolean(record.pressTerminalKeyAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.pressTerminalKeyAutoApprove),
    scrollTerminalAutoApprove: optionalBoolean(record.scrollTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.scrollTerminalAutoApprove),
    waitTerminalAutoApprove: optionalBoolean(record.waitTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.waitTerminalAutoApprove),
    interruptTerminalAutoApprove: optionalBoolean(record.interruptTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.interruptTerminalAutoApprove)
  };
}
function toTerminalUseConfigContributionValues(config, projectRoot = process.cwd()) {
  return {
    enabled: config?.enabled ?? false,
    cwd: config ? path.relative(projectRoot, config.cwd) || "." : ".",
    shell: config?.shell ?? "",
    cols: config?.cols ?? DEFAULT_TERMINAL_USE_CONFIG.cols,
    rows: config?.rows ?? DEFAULT_TERMINAL_USE_CONFIG.rows,
    scrollback: config?.scrollback ?? DEFAULT_TERMINAL_USE_CONFIG.scrollback,
    startupTimeoutMs: config?.startupTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs,
    defaultCommandTimeoutMs: config?.defaultCommandTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs,
    defaultWaitTimeoutMs: config?.defaultWaitTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs,
    idleQuietMs: config?.idleQuietMs ?? DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs,
    maxDisplayChars: config?.maxDisplayChars ?? DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars,
    maxCommandOutputChars: config?.maxCommandOutputChars ?? DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars,
    maxRecentSnapshots: config?.maxRecentSnapshots ?? DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots
  };
}
function toTerminalUseToolsContributionValues(config) {
  const effective = config ?? DEFAULT_TERMINAL_USE_TOOLS_CONFIG;
  return {
    getTerminalSnapshotAutoApprove: effective.getTerminalSnapshotAutoApprove,
    restartTerminalAutoApprove: effective.restartTerminalAutoApprove,
    execClassifierEnabled: effective.execTerminalCommandClassifier.enabled,
    execClassifierModel: effective.execTerminalCommandClassifier.model ?? "",
    execConfidenceThreshold: effective.execTerminalCommandClassifier.confidenceThreshold ?? 0.8,
    execFallbackPolicy: effective.execTerminalCommandClassifier.fallbackPolicy ?? "deny",
    execClassifierTimeout: effective.execTerminalCommandClassifier.timeout ?? 8000,
    typeTerminalTextAutoApprove: effective.typeTerminalTextAutoApprove,
    pressTerminalKeyAutoApprove: effective.pressTerminalKeyAutoApprove,
    scrollTerminalAutoApprove: effective.scrollTerminalAutoApprove,
    waitTerminalAutoApprove: effective.waitTerminalAutoApprove,
    interruptTerminalAutoApprove: effective.interruptTerminalAutoApprove
  };
}
function fromTerminalUseConfigContributionValues(values) {
  const shell = optionalString(values.shell);
  const cwd = optionalString(values.cwd);
  return {
    enabled: values.enabled === true,
    ...cwd ? { cwd } : {},
    ...shell ? { shell } : {},
    cols: positiveNumber(values.cols, DEFAULT_TERMINAL_USE_CONFIG.cols),
    rows: positiveNumber(values.rows, DEFAULT_TERMINAL_USE_CONFIG.rows),
    scrollback: positiveNumber(values.scrollback, DEFAULT_TERMINAL_USE_CONFIG.scrollback),
    startupTimeoutMs: positiveNumber(values.startupTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs),
    defaultCommandTimeoutMs: positiveNumber(values.defaultCommandTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs),
    defaultWaitTimeoutMs: positiveNumber(values.defaultWaitTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs),
    idleQuietMs: positiveNumber(values.idleQuietMs, DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs),
    maxDisplayChars: positiveNumber(values.maxDisplayChars, DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars),
    maxCommandOutputChars: positiveNumber(values.maxCommandOutputChars, DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars),
    maxRecentSnapshots: Math.max(0, positiveNumber(values.maxRecentSnapshots, DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots))
  };
}
function fromTerminalUseToolsContributionValues(values) {
  const model = optionalString(values.execClassifierModel);
  return {
    getTerminalSnapshotAutoApprove: optionalBoolean(values.getTerminalSnapshotAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.getTerminalSnapshotAutoApprove),
    restartTerminalAutoApprove: optionalBoolean(values.restartTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.restartTerminalAutoApprove),
    execTerminalCommandClassifier: {
      enabled: optionalBoolean(values.execClassifierEnabled, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.enabled),
      ...model ? { model } : {},
      confidenceThreshold: typeof values.execConfidenceThreshold === "number" && values.execConfidenceThreshold > 0 && values.execConfidenceThreshold <= 1 ? values.execConfidenceThreshold : DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold ?? 0.8,
      fallbackPolicy: values.execFallbackPolicy === "allow" || values.execFallbackPolicy === "deny" ? values.execFallbackPolicy : DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy ?? "deny",
      timeout: positiveNumber(values.execClassifierTimeout, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout ?? 8000)
    },
    typeTerminalTextAutoApprove: optionalBoolean(values.typeTerminalTextAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.typeTerminalTextAutoApprove),
    pressTerminalKeyAutoApprove: optionalBoolean(values.pressTerminalKeyAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.pressTerminalKeyAutoApprove),
    scrollTerminalAutoApprove: optionalBoolean(values.scrollTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.scrollTerminalAutoApprove),
    waitTerminalAutoApprove: optionalBoolean(values.waitTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.waitTerminalAutoApprove),
    interruptTerminalAutoApprove: optionalBoolean(values.interruptTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.interruptTerminalAutoApprove)
  };
}

// src/terminal-env.ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import * as path2 from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
var logger = createPluginLogger("terminal-use", "TerminalEnv");
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path2.dirname(__filename2);
var extensionDir;
function setExtensionDir(dir) {
  extensionDir = dir;
}

class TerminalEnvironment {
  config;
  child = null;
  rl = null;
  pending = new Map;
  nextId = 1;
  initialized = false;
  shellKind;
  constructor(config) {
    this.config = config;
  }
  async initialize() {
    if (this.initialized)
      return;
    const { cmd, args } = resolveSidecarCommand("terminal-sidecar.ts");
    logger.info(`启动 terminal-use sidecar: ${cmd} ${args.join(" ")}`);
    this.child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env },
      windowsHide: true
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending)
        return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
    });
    let stderrBuffer = "";
    this.child.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });
    this.child.on("exit", (code) => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`terminal-use sidecar 已退出 (code=${code})${stderrBuffer ? `
${stderrBuffer}` : ""}`));
      }
      this.pending.clear();
      this.child = null;
      this.initialized = false;
    });
    try {
      const result = await this.call("initialize", this.config, Math.max(this.config.startupTimeoutMs + 5000, 15000));
      this.shellKind = result.shellKind;
      this.initialized = true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  async dispose() {
    try {
      if (this.child) {
        await this.call("dispose", undefined, 3000);
      }
    } catch {}
    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.rl?.close();
    this.rl = null;
    if (!child)
      return;
    child.stdin?.end();
    if (child.exitCode !== null)
      return;
    await new Promise((resolve3) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform === "win32" && child.pid) {
            spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
          } else {
            child.kill("SIGKILL");
          }
        } catch {}
        resolve3();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve3();
      });
    });
  }
  async snapshot(resetScroll = false) {
    await this.initialize();
    const result = await this.call("snapshot", { resetScroll }, 1e4);
    this.shellKind = result.shellKind;
    return result;
  }
  async execCommand(command, timeoutMs) {
    await this.initialize();
    const result = await this.call("execCommand", { command, timeoutMs }, Math.max(timeoutMs + 5000, 15000));
    this.shellKind = result.shellKind;
    return result;
  }
  async typeText(text, timeoutMs) {
    await this.initialize();
    const result = await this.call("typeText", { text, timeoutMs }, Math.max((timeoutMs ?? 1000) + 5000, 1e4));
    this.shellKind = result.shellKind;
    return result;
  }
  async pressKey(key, timeoutMs) {
    await this.initialize();
    const result = await this.call("pressKey", { key, timeoutMs }, Math.max((timeoutMs ?? 1000) + 5000, 1e4));
    this.shellKind = result.shellKind;
    return result;
  }
  async scroll(direction, lines) {
    await this.initialize();
    const result = await this.call("scroll", { direction, lines }, 1e4);
    this.shellKind = result.shellKind;
    return result;
  }
  async wait(milliseconds, untilIdle, timeoutMs) {
    await this.initialize();
    const effective = timeoutMs ?? milliseconds ?? 1000;
    const result = await this.call("wait", { milliseconds, untilIdle, timeoutMs }, Math.max(effective + 5000, 1e4));
    this.shellKind = result.shellKind;
    return result;
  }
  async interrupt(timeoutMs) {
    await this.initialize();
    const result = await this.call("interrupt", { timeoutMs }, Math.max((timeoutMs ?? 1000) + 5000, 1e4));
    this.shellKind = result.shellKind;
    return result;
  }
  call(method, params, timeoutMs = 30000) {
    if (!this.child?.stdin) {
      return Promise.reject(new Error("terminal-use sidecar 未启动"));
    }
    const id = this.nextId++;
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`terminal-use sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve3(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.child.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + `
`);
    });
  }
}
function resolveSidecarCommand(sidecarFile) {
  const devTs = path2.resolve(__dirname2, sidecarFile);
  if (fs.existsSync(devTs)) {
    return { cmd: "node", args: ["--import", "tsx", devTs] };
  }
  if (extensionDir) {
    const distMjs = path2.resolve(extensionDir, "dist", sidecarFile.replace(".ts", ".mjs"));
    if (fs.existsSync(distMjs)) {
      return { cmd: "node", args: [distMjs] };
    }
  }
  if (process.release?.name === "node") {
    return { cmd: process.execPath, args: [path2.resolve(__dirname2, sidecarFile)] };
  }
  return { cmd: "node", args: [path2.resolve(__dirname2, sidecarFile)] };
}

// src/security.ts
var DEFAULT_CLASSIFIER = {
  enabled: true,
  confidenceThreshold: 0.8,
  fallbackPolicy: "deny",
  timeout: 8000
};
var UNIX_DENY_PATTERNS = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)?\/(\s|$)/i, reason: "禁止删除根目录" },
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)?~\/?(\s|$)/i, reason: "禁止删除用户主目录" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, reason: "禁止 curl | bash 远程执行" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, reason: "禁止 wget | bash 远程执行" },
  { pattern: /\bsudo\b/i, reason: "禁止 sudo 提权" },
  { pattern: /\beval\b/i, reason: "禁止 eval 动态执行" },
  { pattern: /\bmkfs\b/i, reason: "禁止格式化文件系统" },
  { pattern: /\bdd\b.*\bof=\/dev\//i, reason: "禁止直接写入磁盘设备" },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: "禁止关机/重启" }
];
var WINDOWS_DENY_PATTERNS = [
  { pattern: /\bformat\b.*\b[a-zA-Z]:/i, reason: "禁止格式化磁盘" },
  { pattern: /\b(shutdown|restart-computer|stop-computer)\b/i, reason: "禁止关机/重启" },
  { pattern: /Invoke-WebRequest\b.*\|.*Invoke-Expression\b/i, reason: "禁止 iwr | iex 远程执行" },
  { pattern: /\biwr\b.*\|.*\biex\b/i, reason: "禁止 iwr | iex 远程执行" },
  { pattern: /\bInvoke-Expression\b/i, reason: "禁止 Invoke-Expression 动态执行" },
  { pattern: /\biex\b/i, reason: "禁止 iex 动态执行" },
  { pattern: /\bRemove-Item\b.*-Recurse.*-Force.*([A-Za-z]:\\|\\$)/i, reason: "禁止递归强制删除关键路径" },
  { pattern: /Start-Process\b.*-Verb\s+RunAs/i, reason: "禁止提权运行" },
  { pattern: /\breg\s+delete\b.*\bHKLM/i, reason: "禁止删除 HKLM 注册表" }
];
var UNIX_SAFE_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "pwd",
  "cd",
  "grep",
  "egrep",
  "fgrep",
  "find",
  "rg",
  "fd",
  "fdfind",
  "stat",
  "file",
  "tree",
  "less",
  "more",
  "ps",
  "whoami",
  "uname",
  "env",
  "printenv",
  "which",
  "echo",
  "realpath",
  "basename",
  "dirname",
  "readlink",
  "id",
  "uptime",
  "df",
  "du"
]);
var WINDOWS_SAFE_COMMANDS = new Set([
  "dir",
  "type",
  "more",
  "findstr",
  "where",
  "where.exe",
  "echo",
  "whoami",
  "systeminfo",
  "tasklist",
  "ping",
  "ipconfig",
  "hostname",
  "get-childitem",
  "get-content",
  "get-location",
  "set-location",
  "select-string",
  "get-process",
  "get-service",
  "get-command",
  "get-help",
  "test-path",
  "resolve-path",
  "get-date",
  "get-computerinfo"
]);
var SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "branch", "remote", "rev-parse"]);
var SAFE_NPM_SUBCOMMANDS = new Set(["list", "ls", "view", "info"]);
function firstTokens(command) {
  return command.trim().split(/\s+/).filter(Boolean);
}
function classifyGit(tokens) {
  const sub = tokens[1]?.toLowerCase();
  if (sub && SAFE_GIT_SUBCOMMANDS.has(sub))
    return { result: "allow" };
  return { result: "unknown" };
}
function classifyPackageManager(tokens) {
  const sub = tokens[1]?.toLowerCase();
  if (sub && SAFE_NPM_SUBCOMMANDS.has(sub))
    return { result: "allow" };
  return { result: "unknown" };
}
function classifyFind(tokens) {
  if (tokens.some((token) => /^(-exec|-execdir|-delete|-ok|-okdir)$/i.test(token))) {
    return { result: "unknown" };
  }
  return { result: "allow" };
}
function classifyUnix(command) {
  for (const { pattern, reason } of UNIX_DENY_PATTERNS) {
    if (pattern.test(command))
      return { result: "deny", reason };
  }
  if (/\s>>?\s/.test(command) || /\|\s*tee\b/i.test(command)) {
    return { result: "unknown" };
  }
  const tokens = firstTokens(command);
  const first = tokens[0]?.toLowerCase();
  if (!first)
    return { result: "allow" };
  if (first === "git")
    return classifyGit(tokens);
  if (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun")
    return classifyPackageManager(tokens);
  if (first === "find")
    return classifyFind(tokens);
  if (first === "sed" && tokens.some((token) => /^-[a-zA-Z]*i/.test(token)))
    return { result: "unknown" };
  if (UNIX_SAFE_COMMANDS.has(first))
    return { result: "allow" };
  return { result: "unknown" };
}
function classifyWindows(command) {
  for (const { pattern, reason } of WINDOWS_DENY_PATTERNS) {
    if (pattern.test(command))
      return { result: "deny", reason };
  }
  if (/\s>>?\s/.test(command) || /\b(Out-File|Set-Content|Add-Content)\b/i.test(command)) {
    return { result: "unknown" };
  }
  const tokens = firstTokens(command);
  const first = tokens[0]?.toLowerCase();
  if (!first)
    return { result: "allow" };
  if (first === "git")
    return classifyGit(tokens);
  if (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun")
    return classifyPackageManager(tokens);
  if (WINDOWS_SAFE_COMMANDS.has(first))
    return { result: "allow" };
  return { result: "unknown" };
}
function classifyStaticCommand(command, shellKind) {
  const trimmed = command.trim();
  if (!trimmed)
    return { result: "allow" };
  return shellKind === "powershell" ? classifyWindows(trimmed) : classifyUnix(trimmed);
}
function buildClassifierPrompt(shellKind, cwd) {
  const platform = shellKind === "powershell" ? "Windows PowerShell" : "Unix shell";
  const shellName = shellKind === "powershell" ? "powershell" : "bash";
  const dangerousPatterns = shellKind === "powershell" ? `- Destructive filesystem operations (Remove-Item -Recurse -Force, del, format)
- Download and execute (iwr | iex, Invoke-Expression)
- Privilege escalation (RunAs)
- git push/commit/reset --hard
- npm/pip install or other dependency installation
- Registry or service modification` : `- Destructive filesystem operations (rm -rf, dd, mkfs)
- Download and execute (curl|bash, wget|bash)
- Privilege escalation (sudo, su)
- eval or dynamic code execution
- git push/commit/reset --hard
- npm/pip/apt install or other dependency installation`;
  return `You are a terminal command safety classifier for ${platform}.
Reply with ONLY JSON:
{"safe": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}

safe=true only when the command is low-risk in the current project context.
Treat filesystem modification, dependency installation, remote execution, privilege escalation, destructive operations, and repo state changes as unsafe.

Dangerous patterns:
${dangerousPatterns}

Context:
- Shell: ${shellName}
- Working directory: ${cwd}`;
}
function parseClassifierResponse(content) {
  const text = content?.parts?.map((part) => ("text" in part) ? part.text : "").join("").trim();
  if (!text)
    return null;
  try {
    return validateClassifierResult(JSON.parse(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
      return null;
    try {
      return validateClassifierResult(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}
function validateClassifierResult(value) {
  if (!value || typeof value !== "object")
    return null;
  const record = value;
  if (typeof record.safe !== "boolean")
    return null;
  return {
    safe: record.safe,
    confidence: typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0.5,
    reason: typeof record.reason === "string" ? record.reason : record.safe ? "classified as safe" : "classified as dangerous"
  };
}
async function classifyWithLLM(command, shellKind, cwd, router, config) {
  if (!router?.chat)
    return null;
  const timeout = config?.timeout ?? DEFAULT_CLASSIFIER.timeout;
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await router.chat({
      systemInstruction: { parts: [{ text: buildClassifierPrompt(shellKind, cwd) }] },
      contents: [{ role: "user", parts: [{ text: `Is this command safe to execute?

${command}` }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 200
      }
    }, config?.model, controller.signal);
    return parseClassifierResponse(response.content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function resolveClassifierDecision(result, config) {
  const threshold = config?.confidenceThreshold ?? DEFAULT_CLASSIFIER.confidenceThreshold;
  const fallback = config?.fallbackPolicy ?? DEFAULT_CLASSIFIER.fallbackPolicy;
  if (!result) {
    return {
      allow: fallback === "allow",
      reason: `分类器无法判定，兜底策略: ${fallback}`
    };
  }
  if (result.safe && result.confidence >= threshold) {
    return { allow: true, reason: result.reason };
  }
  if (!result.safe && result.confidence >= threshold) {
    return { allow: false, reason: result.reason };
  }
  return {
    allow: fallback === "allow",
    reason: `置信度不足 (${result.confidence.toFixed(2)}, 阈值 ${threshold}): ${result.reason}。兜底策略: ${fallback}`
  };
}

// src/tools.ts
function toToolResult(state) {
  const {
    display,
    rows,
    cols,
    cursorRow,
    cursorCol,
    promptReady,
    altScreen,
    shellKind,
    cwd,
    scrollback,
    timedOut,
    truncated,
    exitCode,
    output,
    commandOutput,
    command
  } = state;
  const meta = {
    rows,
    cols,
    cursorRow,
    cursorCol,
    promptReady,
    altScreen,
    shellKind
  };
  if (cwd !== undefined)
    meta.cwd = cwd;
  if (scrollback !== undefined)
    meta.scrollback = scrollback;
  if (timedOut !== undefined)
    meta.timedOut = timedOut;
  if (truncated !== undefined)
    meta.truncated = truncated;
  if (exitCode !== undefined)
    meta.exitCode = exitCode;
  const result = {
    screen: display,
    meta
  };
  if (output !== undefined)
    result.output = output;
  if (commandOutput !== undefined)
    result.commandOutput = commandOutput;
  if (command !== undefined)
    result.command = command;
  return result;
}
var TERMINAL_USE_FUNCTION_NAMES = new Set([
  "get_terminal_snapshot",
  "restart_terminal",
  "exec_terminal_command",
  "type_terminal_text",
  "press_terminal_key",
  "scroll_terminal",
  "wait_terminal",
  "interrupt_terminal"
]);
function defaultShellKind() {
  return process.platform === "win32" ? "powershell" : "bash";
}
async function ensureActionApproved(toolName, autoApprove, context) {
  if (autoApprove || context?.approvedByUser)
    return;
  if (context?.requestApproval) {
    const approved = await context.requestApproval();
    if (approved)
      return;
    throw new Error("用户已拒绝执行该操作。");
  }
  throw new Error(`terminal-use 工具「${toolName}」未启用自动批准，且当前上下文无法请求人工确认。请通过 terminal-use 的配置贡献开启该工具的 autoApprove。`);
}
async function authorizeCommand(command, shellKind, cwd, router, classifierConfig, context, force = false) {
  const staticDecision = classifyStaticCommand(command, shellKind);
  if (staticDecision.result === "deny") {
    throw new Error(`安全拒绝: ${staticDecision.reason}
此命令处于 terminal-use 黑名单中，force 也无法绕过。`);
  }
  if (staticDecision.result === "allow") {
    return;
  }
  if (context?.approvedByUser) {
    return;
  }
  if (force && !context?.requestApproval) {
    return;
  }
  const config = classifierConfig;
  if (!config?.enabled) {
    if (context?.requestApproval) {
      const approved = await context.requestApproval();
      if (approved)
        return;
      throw new Error("用户已拒绝执行该命令。");
    }
    throw new Error("命令不在安全白名单中且分类器未启用，拒绝执行。请让用户确认后使用 force: true，或在 terminal-use 的配置贡献中为 exec_terminal_command 启用 classifier。");
  }
  const classifierResult = await classifyWithLLM(command, shellKind, cwd, router, config);
  const decision = resolveClassifierDecision(classifierResult, config);
  if (decision.allow) {
    return;
  }
  if (context?.requestApproval) {
    const approved = await context.requestApproval();
    if (approved)
      return;
    throw new Error("用户已拒绝执行该命令。");
  }
  throw new Error(`AI 安全分类器拒绝执行: ${decision.reason}
如果用户确认需要执行，可以设置 force: true 重试。`);
}
function createTerminalUseTools(deps) {
  const getConfig = () => deps.getConfig();
  const getToolsConfig = () => deps.getToolsConfig();
  const getDefaultCommandTimeout = () => getConfig()?.defaultCommandTimeoutMs ?? 30000;
  const getDefaultWaitTimeout = () => getConfig()?.defaultWaitTimeoutMs ?? 1e4;
  return [
    {
      approvalMode: "handler",
      declaration: {
        name: "get_terminal_snapshot",
        description: "获取当前无头终端的可见页面文本。用于观察当前提示符、命令输出、TUI 界面或滚动后的视图。",
        parameters: {
          type: "object",
          properties: {
            reset_scroll: {
              type: "boolean",
              description: "是否重置滚动位置并回到底部实时视图，默认 false。"
            }
          }
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("get_terminal_snapshot", getToolsConfig().getTerminalSnapshotAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.snapshot(args.reset_scroll ?? false));
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "restart_terminal",
        description: "重启 terminal-use 的无头终端会话，并返回新会话的初始页面文本。会丢失当前终端中的未保存上下文、前台程序和会话状态。"
      },
      handler: async (_args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("restart_terminal", getToolsConfig().restartTerminalAutoApprove, context);
        return toToolResult(await deps.restartEnv());
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "exec_terminal_command",
        description: [
          "在持久终端会话中执行一条命令并等待返回 prompt 或超时。",
          "返回当前可见页面 display，以及本次命令执行产生的完整 commandOutput（过长会截断并标记）。",
          "适合 ls、git status、pytest、python script.py、npm run 等。",
          "如果命令启动了长时间运行的交互程序（如 python REPL、top、vim），超时后会返回当前页面，你可以继续用 wait_terminal / press_terminal_key / type_terminal_text 操作。"
        ].join(""),
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "要执行的命令。建议单行输入；终端会保持状态，cd/export 等会影响后续操作。"
            },
            timeout: {
              type: "number",
              description: "等待命令完成的超时（毫秒），默认取 terminal_use.yaml 中 defaultCommandTimeoutMs。"
            },
            force: {
              type: "boolean",
              description: "在非交互上下文中跳过 AI 分类器的最终阻断。黑名单命令仍无法执行。"
            }
          },
          required: ["command"]
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        const env = await deps.getEnv();
        const currentState = await env.snapshot(false);
        const command = String(args.command ?? "");
        const timeout = Math.min(args.timeout ?? getDefaultCommandTimeout(), 600000);
        const force = args.force === true;
        await authorizeCommand(command, currentState.shellKind ?? env.shellKind ?? defaultShellKind(), currentState.cwd ?? getConfig()?.cwd ?? process.cwd(), deps.getRouter(), getToolsConfig().execTerminalCommandClassifier, context, force);
        return toToolResult(await env.execCommand(command, timeout));
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "type_terminal_text",
        description: "向当前终端焦点输入原始文本，但不额外发送 Enter。适合 REPL、TUI 输入框或分步构造命令。",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "要输入的文本。会原样发送到当前终端会话。"
            },
            timeout: {
              type: "number",
              description: "发送后等待终端稳定的最长时间（毫秒），默认约 800~1000ms。"
            }
          },
          required: ["text"]
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("type_terminal_text", getToolsConfig().typeTerminalTextAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.typeText(String(args.text ?? ""), args.timeout));
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "press_terminal_key",
        description: "向终端发送一个按键或常见组合键，如 Enter、Up、Down、PageUp、Ctrl+C、Ctrl+D、Alt+X、Shift+Tab。",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: '按键名或组合键，例如 "Enter"、"Up"、"Ctrl+C"、"Alt+X"。'
            },
            timeout: {
              type: "number",
              description: "发送后等待终端稳定的最长时间（毫秒）。"
            }
          },
          required: ["key"]
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("press_terminal_key", getToolsConfig().pressTerminalKeyAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.pressKey(String(args.key ?? ""), args.timeout));
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "scroll_terminal",
        description: "滚动 terminal-use 的文本视图浏览 scrollback。它不会给程序发送 PageUp/PageDown，而是只改变你看到的页面。",
        parameters: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              description: "滚动方向：up 或 down。"
            },
            lines: {
              type: "number",
              description: "滚动行数，默认约半屏。"
            }
          },
          required: ["direction"]
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("scroll_terminal", getToolsConfig().scrollTerminalAutoApprove, context);
        const env = await deps.getEnv();
        const direction = args.direction === "up" ? "up" : "down";
        return toToolResult(await env.scroll(direction, args.lines));
      }
    },
    {
      approvalMode: "handler",
      declaration: (() => {
        const declaration = {
          name: "wait_terminal",
          description: "等待一段时间，或等待终端输出进入空闲状态，然后返回当前页面。适合等待长命令继续输出或动画/TUI 刷新。",
          parameters: {
            type: "object",
            properties: {
              milliseconds: {
                type: "number",
                description: "固定等待时间（毫秒），默认 1000。"
              },
              until_idle: {
                type: "boolean",
                description: "若为 true，则等待到终端至少静默一个短窗口，或直到 timeout。"
              },
              timeout: {
                type: "number",
                description: "当 until_idle=true 时的最长等待时间；否则可作为固定等待的上限说明。默认取 terminal_use.yaml 中 defaultWaitTimeoutMs。"
              }
            }
          }
        };
        return declaration;
      })(),
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("wait_terminal", getToolsConfig().waitTerminalAutoApprove, context);
        const env = await deps.getEnv();
        const timeout = args.timeout ?? getDefaultWaitTimeout();
        return toToolResult(await env.wait(args.milliseconds, args.until_idle ?? false, timeout));
      }
    },
    {
      approvalMode: "handler",
      declaration: {
        name: "interrupt_terminal",
        description: "向当前终端发送 Ctrl+C 中断前台程序，并返回当前页面。适合停止卡住或运行过久的命令。",
        parameters: {
          type: "object",
          properties: {
            timeout: {
              type: "number",
              description: "中断后等待终端稳定的最长时间（毫秒）。"
            }
          }
        }
      },
      handler: async (args, rawContext) => {
        const context = rawContext;
        await ensureActionApproved("interrupt_terminal", getToolsConfig().interruptTerminalAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.interrupt(args.timeout));
      }
    }
  ];
}

// src/index.ts
var logger2 = createPluginLogger("terminal-use");
var activeConfig;
var activeToolsConfig = { ...DEFAULT_TERMINAL_USE_TOOLS_CONFIG };
var activeEnv;
var cachedApi;
var lastConfigSnapshot = "";
var toolsRegistered = false;
var reloading = false;
var pendingReload = null;
var contributionDisposables = [];
var src_default = definePlugin({
  name: "terminal-use",
  version: "0.1.0",
  description: "Persistent headless terminal session for LLM tool use",
  activate(ctx) {
    const extDir = ctx.getExtensionRootDir();
    setExtensionDir(extDir);
    const created = ctx.ensureConfigFile("terminal_use.yaml", DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger2.info("已在配置目录中安装 terminal_use.yaml 默认模板");
    }
    const createdToolConfig = ctx.ensureConfigFile("terminal_use_tools.yaml", DEFAULT_TOOLS_CONFIG_TEMPLATE);
    if (createdToolConfig) {
      logger2.info("已在配置目录中安装 terminal_use_tools.yaml 默认模板");
    }
    registerConfigContributions(ctx);
    ctx.onReady(async (api) => {
      cachedApi = api;
      const raw = resolveRawConfigs(ctx, api);
      await safeReload(raw.rawConfig, raw.rawToolsConfig, api, ctx);
    });
    ctx.addHook({
      name: "terminal-use:config-reload",
      async onConfigReload({ rawMergedConfig }) {
        if (!cachedApi)
          return;
        const merged = rawMergedConfig;
        const rawConfig = merged.terminal_use;
        const rawToolsConfig = merged.terminal_use_tools;
        await safeReload(rawConfig, rawToolsConfig, cachedApi, ctx);
      }
    });
    ctx.addHook({
      name: "terminal-use:prune-old-snapshots",
      onBeforeLLMCall({ request }) {
        const max = activeConfig?.maxRecentSnapshots ?? 0;
        if (!activeConfig || max === Infinity)
          return;
        let snapshotRounds = 0;
        for (let i = request.contents.length - 1;i >= 0; i--) {
          const content = request.contents[i];
          if (content.role !== "user")
            continue;
          const hasTerminalSnapshot = content.parts.some((part) => ("functionResponse" in part) && TERMINAL_USE_FUNCTION_NAMES.has(part.functionResponse.name));
          if (!hasTerminalSnapshot)
            continue;
          snapshotRounds += 1;
          if (snapshotRounds <= max)
            continue;
          for (const part of content.parts) {
            if (!("functionResponse" in part))
              continue;
            const functionResponse = part.functionResponse;
            if (!TERMINAL_USE_FUNCTION_NAMES.has(functionResponse.name))
              continue;
            const response = functionResponse.response;
            const result = response?.result;
            if (!result || typeof result !== "object")
              continue;
            delete result.screen;
            delete result.display;
            delete result.output;
            delete result.commandOutput;
            result.snapshotPruned = true;
          }
        }
        return { request };
      }
    });
  },
  async deactivate() {
    for (const disposable of contributionDisposables.splice(0, contributionDisposables.length)) {
      try {
        disposable.dispose();
      } catch {}
    }
    await destroyEnvironment();
  }
});
function resolveRawConfigs(ctx, api) {
  const pluginConfig = ctx.getPluginConfig();
  return {
    rawConfig: ctx.readConfigSection("terminal_use") ?? pluginConfig ?? api.config.terminal_use ?? api.config.terminalUse,
    rawToolsConfig: ctx.readConfigSection("terminal_use_tools") ?? api.config.terminal_use_tools
  };
}
async function getEnvironment() {
  if (!activeConfig) {
    throw new Error("terminal-use 未启用。请先在 terminal_use.yaml 中设置 enabled: true，并在 plugins.yaml 中加载 terminal-use 插件。");
  }
  if (activeEnv)
    return activeEnv;
  const env = new TerminalEnvironment({
    shell: activeConfig.shell,
    cwd: activeConfig.cwd,
    cols: activeConfig.cols,
    rows: activeConfig.rows,
    scrollback: activeConfig.scrollback,
    startupTimeoutMs: activeConfig.startupTimeoutMs,
    idleQuietMs: activeConfig.idleQuietMs,
    maxDisplayChars: activeConfig.maxDisplayChars,
    maxCommandOutputChars: activeConfig.maxCommandOutputChars
  });
  await env.initialize();
  activeEnv = env;
  return env;
}
async function destroyEnvironment() {
  if (!activeEnv)
    return;
  try {
    await activeEnv.dispose();
  } catch {}
  activeEnv = undefined;
}
async function restartEnvironment() {
  await destroyEnvironment();
  const env = await getEnvironment();
  return env.snapshot(true);
}
function unregisterTools(api) {
  const registry = api.tools;
  if (!registry.unregister)
    return;
  for (const name of TERMINAL_USE_FUNCTION_NAMES) {
    registry.unregister(name);
  }
  toolsRegistered = false;
}
function registerTools(api) {
  if (toolsRegistered)
    return;
  api.tools.registerAll(createTerminalUseTools({
    getEnv: getEnvironment,
    restartEnv: restartEnvironment,
    getConfig: () => activeConfig,
    getRouter: () => cachedApi?.router,
    getToolsConfig: () => activeToolsConfig
  }));
  toolsRegistered = true;
}
async function safeReload(rawConfig, rawToolsConfig, api, ctx) {
  if (reloading) {
    pendingReload = { rawConfig, rawToolsConfig, api, ctx };
    return;
  }
  reloading = true;
  try {
    await doReload(rawConfig, rawToolsConfig, api, ctx);
  } finally {
    reloading = false;
    if (pendingReload) {
      const next = pendingReload;
      pendingReload = null;
      await safeReload(next.rawConfig, next.rawToolsConfig, next.api, next.ctx);
    }
  }
}
async function doReload(rawConfig, rawToolsConfig, api, ctx) {
  const snapshot = JSON.stringify({ rawConfig: rawConfig ?? null, rawToolsConfig: rawToolsConfig ?? null });
  if (snapshot === lastConfigSnapshot)
    return;
  lastConfigSnapshot = snapshot;
  const parsed = parseTerminalUseConfig(rawConfig, api.projectRoot ?? process.cwd());
  activeToolsConfig = parseTerminalUseToolsConfig(rawToolsConfig);
  activeConfig = parsed;
  await destroyEnvironment();
  if (!parsed?.enabled) {
    unregisterTools(api);
    logger2.info("terminal-use 已禁用");
    return;
  }
  registerTools(api);
  logger2.info(`terminal-use 已启用 [cwd=${parsed.cwd}, cols=${parsed.cols}, rows=${parsed.rows}]`);
}
function registerConfigContributions(ctx) {
  const registry = ctx.getConfigContributions();
  const terminalUseContribution = {
    pluginName: "terminal-use",
    sectionId: "terminal_use",
    title: "Terminal Use",
    description: "terminal-use 扩展自己的终端会话配置。",
    fields: [
      { key: "enabled", type: "boolean", label: "启用 Terminal Use", default: false, group: "基础" },
      { key: "cwd", type: "string", label: "启动目录", default: ".", group: "基础" },
      { key: "shell", type: "string", label: "Shell 路径", default: "", group: "基础", description: "可选。留空则自动选择当前平台默认 shell。" },
      { key: "cols", type: "number", label: "列数", default: 120, group: "终端" },
      { key: "rows", type: "number", label: "行数", default: 32, group: "终端" },
      { key: "scrollback", type: "number", label: "Scrollback 行数", default: 5000, group: "终端" },
      { key: "startupTimeoutMs", type: "number", label: "启动超时(ms)", default: 1e4, group: "超时" },
      { key: "defaultCommandTimeoutMs", type: "number", label: "默认命令超时(ms)", default: 30000, group: "超时" },
      { key: "defaultWaitTimeoutMs", type: "number", label: "默认等待超时(ms)", default: 1e4, group: "超时" },
      { key: "idleQuietMs", type: "number", label: "空闲静默窗口(ms)", default: 350, group: "超时" },
      { key: "maxDisplayChars", type: "number", label: "最大屏幕字符数", default: 12000, group: "输出" },
      { key: "maxCommandOutputChars", type: "number", label: "最大命令输出字符数", default: 50000, group: "输出" },
      { key: "maxRecentSnapshots", type: "number", label: "保留最近快照轮数", default: 3, group: "输出" }
    ],
    onLoad: () => toTerminalUseConfigContributionValues(parseTerminalUseConfig(ctx.readConfigSection("terminal_use"), cachedApi?.projectRoot ?? process.cwd()), cachedApi?.projectRoot ?? process.cwd()),
    onSave: async (values) => {
      if (!cachedApi?.configManager)
        throw new Error("configManager 不可用，无法保存 terminal_use 配置");
      const raw = fromTerminalUseConfigContributionValues(values);
      const { mergedRaw } = cachedApi.configManager.updateEditableConfig({ terminal_use: raw });
      await cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    }
  };
  const terminalUseToolsContribution = {
    pluginName: "terminal-use",
    sectionId: "terminal_use_tools",
    title: "Terminal Use Tools",
    description: "terminal-use 工具自身的审批与安全分类配置。",
    fields: [
      { key: "getTerminalSnapshotAutoApprove", type: "boolean", label: "自动批准 get_terminal_snapshot", default: true, group: "审批" },
      { key: "restartTerminalAutoApprove", type: "boolean", label: "自动批准 restart_terminal", default: false, group: "审批" },
      { key: "typeTerminalTextAutoApprove", type: "boolean", label: "自动批准 type_terminal_text", default: false, group: "审批" },
      { key: "pressTerminalKeyAutoApprove", type: "boolean", label: "自动批准 press_terminal_key", default: false, group: "审批" },
      { key: "scrollTerminalAutoApprove", type: "boolean", label: "自动批准 scroll_terminal", default: true, group: "审批" },
      { key: "waitTerminalAutoApprove", type: "boolean", label: "自动批准 wait_terminal", default: true, group: "审批" },
      { key: "interruptTerminalAutoApprove", type: "boolean", label: "自动批准 interrupt_terminal", default: false, group: "审批" },
      { key: "execClassifierEnabled", type: "boolean", label: "启用 exec_terminal_command 分类器", default: true, group: "命令安全" },
      { key: "execClassifierModel", type: "string", label: "分类器模型", default: "", group: "命令安全" },
      { key: "execConfidenceThreshold", type: "number", label: "分类器置信度阈值", default: 0.8, group: "命令安全", validation: { min: 0, max: 1 } },
      { key: "execFallbackPolicy", type: "select", label: "分类器兜底策略", default: "deny", group: "命令安全", options: [{ label: "拒绝", value: "deny" }, { label: "放行", value: "allow" }] },
      { key: "execClassifierTimeout", type: "number", label: "分类器超时(ms)", default: 8000, group: "命令安全" }
    ],
    onLoad: () => toTerminalUseToolsContributionValues(parseTerminalUseToolsConfig(ctx.readConfigSection("terminal_use_tools"))),
    onSave: async (values) => {
      if (!cachedApi?.configManager)
        throw new Error("configManager 不可用，无法保存 terminal_use_tools 配置");
      const raw = fromTerminalUseToolsContributionValues(values);
      const { mergedRaw } = cachedApi.configManager.updateEditableConfig({ terminal_use_tools: raw });
      await cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    }
  };
  contributionDisposables.push(registry.register(terminalUseContribution));
  contributionDisposables.push(registry.register(terminalUseToolsContribution));
}
export {
  src_default as default
};
