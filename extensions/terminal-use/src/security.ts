import type { Content, LLMRouterLike } from 'irises-extension-sdk';
import type { TerminalClassifierConfig, TerminalShellKind } from './types.js';

export type StaticDecision =
  | { result: 'allow' }
  | { result: 'deny'; reason: string }
  | { result: 'unknown' };

export interface ClassifierResult {
  safe: boolean;
  confidence: number;
  reason: string;
}

const DEFAULT_CLASSIFIER: Required<Omit<TerminalClassifierConfig, 'model'>> = {
  enabled: true,
  confidenceThreshold: 0.8,
  fallbackPolicy: 'deny',
  timeout: 8000,
};

const UNIX_DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)?\/(\s|$)/i, reason: '禁止删除根目录' },
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)?~\/?(\s|$)/i, reason: '禁止删除用户主目录' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, reason: '禁止 curl | bash 远程执行' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, reason: '禁止 wget | bash 远程执行' },
  { pattern: /\bsudo\b/i, reason: '禁止 sudo 提权' },
  { pattern: /\beval\b/i, reason: '禁止 eval 动态执行' },
  { pattern: /\bmkfs\b/i, reason: '禁止格式化文件系统' },
  { pattern: /\bdd\b.*\bof=\/dev\//i, reason: '禁止直接写入磁盘设备' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: '禁止关机/重启' },
];

const WINDOWS_DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bformat\b.*\b[a-zA-Z]:/i, reason: '禁止格式化磁盘' },
  { pattern: /\b(shutdown|restart-computer|stop-computer)\b/i, reason: '禁止关机/重启' },
  { pattern: /Invoke-WebRequest\b.*\|.*Invoke-Expression\b/i, reason: '禁止 iwr | iex 远程执行' },
  { pattern: /\biwr\b.*\|.*\biex\b/i, reason: '禁止 iwr | iex 远程执行' },
  { pattern: /\bInvoke-Expression\b/i, reason: '禁止 Invoke-Expression 动态执行' },
  { pattern: /\biex\b/i, reason: '禁止 iex 动态执行' },
  { pattern: /\bRemove-Item\b.*-Recurse.*-Force.*([A-Za-z]:\\|\\$)/i, reason: '禁止递归强制删除关键路径' },
  { pattern: /Start-Process\b.*-Verb\s+RunAs/i, reason: '禁止提权运行' },
  { pattern: /\breg\s+delete\b.*\bHKLM/i, reason: '禁止删除 HKLM 注册表' },
];

const UNIX_SAFE_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'cd', 'grep', 'egrep', 'fgrep', 'find', 'rg', 'fd', 'fdfind',
  'stat', 'file', 'tree', 'less', 'more', 'ps', 'whoami', 'uname', 'env', 'printenv', 'which', 'echo',
  'realpath', 'basename', 'dirname', 'readlink', 'id', 'uptime', 'df', 'du',
]);

const WINDOWS_SAFE_COMMANDS = new Set([
  'dir', 'type', 'more', 'findstr', 'where', 'where.exe', 'echo', 'whoami', 'systeminfo', 'tasklist', 'ping',
  'ipconfig', 'hostname', 'get-childitem', 'get-content', 'get-location', 'set-location', 'select-string',
  'get-process', 'get-service', 'get-command', 'get-help', 'test-path', 'resolve-path', 'get-date',
  'get-computerinfo',
]);

const SAFE_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse']);
const SAFE_NPM_SUBCOMMANDS = new Set(['list', 'ls', 'view', 'info']);

function firstTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function classifyGit(tokens: string[]): StaticDecision {
  const sub = tokens[1]?.toLowerCase();
  if (sub && SAFE_GIT_SUBCOMMANDS.has(sub)) return { result: 'allow' };
  return { result: 'unknown' };
}

function classifyPackageManager(tokens: string[]): StaticDecision {
  const sub = tokens[1]?.toLowerCase();
  if (sub && SAFE_NPM_SUBCOMMANDS.has(sub)) return { result: 'allow' };
  return { result: 'unknown' };
}

function classifyFind(tokens: string[]): StaticDecision {
  if (tokens.some(token => /^(-exec|-execdir|-delete|-ok|-okdir)$/i.test(token))) {
    return { result: 'unknown' };
  }
  return { result: 'allow' };
}

function classifyUnix(command: string): StaticDecision {
  for (const { pattern, reason } of UNIX_DENY_PATTERNS) {
    if (pattern.test(command)) return { result: 'deny', reason };
  }

  if (/\s>>?\s/.test(command) || /\|\s*tee\b/i.test(command)) {
    return { result: 'unknown' };
  }

  const tokens = firstTokens(command);
  const first = tokens[0]?.toLowerCase();
  if (!first) return { result: 'allow' };
  if (first === 'git') return classifyGit(tokens);
  if (first === 'npm' || first === 'pnpm' || first === 'yarn' || first === 'bun') return classifyPackageManager(tokens);
  if (first === 'find') return classifyFind(tokens);
  if (first === 'sed' && tokens.some(token => /^-[a-zA-Z]*i/.test(token))) return { result: 'unknown' };
  if (UNIX_SAFE_COMMANDS.has(first)) return { result: 'allow' };
  return { result: 'unknown' };
}

function classifyWindows(command: string): StaticDecision {
  for (const { pattern, reason } of WINDOWS_DENY_PATTERNS) {
    if (pattern.test(command)) return { result: 'deny', reason };
  }

  if (/\s>>?\s/.test(command) || /\b(Out-File|Set-Content|Add-Content)\b/i.test(command)) {
    return { result: 'unknown' };
  }

  const tokens = firstTokens(command);
  const first = tokens[0]?.toLowerCase();
  if (!first) return { result: 'allow' };
  if (first === 'git') return classifyGit(tokens);
  if (first === 'npm' || first === 'pnpm' || first === 'yarn' || first === 'bun') return classifyPackageManager(tokens);
  if (WINDOWS_SAFE_COMMANDS.has(first)) return { result: 'allow' };
  return { result: 'unknown' };
}

export function classifyStaticCommand(command: string, shellKind: TerminalShellKind): StaticDecision {
  const trimmed = command.trim();
  if (!trimmed) return { result: 'allow' };
  return shellKind === 'powershell' ? classifyWindows(trimmed) : classifyUnix(trimmed);
}

function buildClassifierPrompt(shellKind: TerminalShellKind, cwd: string): string {
  const platform = shellKind === 'powershell' ? 'Windows PowerShell' : 'Unix shell';
  const shellName = shellKind === 'powershell' ? 'powershell' : 'bash';
  const dangerousPatterns = shellKind === 'powershell'
    ? `- Destructive filesystem operations (Remove-Item -Recurse -Force, del, format)
- Download and execute (iwr | iex, Invoke-Expression)
- Privilege escalation (RunAs)
- git push/commit/reset --hard
- npm/pip install or other dependency installation
- Registry or service modification`
    : `- Destructive filesystem operations (rm -rf, dd, mkfs)
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

function parseClassifierResponse(content: Content | undefined): ClassifierResult | null {
  const text = content?.parts
    ?.map(part => ('text' in part ? part.text : ''))
    .join('')
    .trim();

  if (!text) return null;

  try {
    return validateClassifierResult(JSON.parse(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return validateClassifierResult(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}

function validateClassifierResult(value: unknown): ClassifierResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.safe !== 'boolean') return null;
  return {
    safe: record.safe,
    confidence: typeof record.confidence === 'number'
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.5,
    reason: typeof record.reason === 'string'
      ? record.reason
      : (record.safe ? 'classified as safe' : 'classified as dangerous'),
  };
}

export async function classifyWithLLM(
  command: string,
  shellKind: TerminalShellKind,
  cwd: string,
  router?: LLMRouterLike,
  config?: TerminalClassifierConfig,
): Promise<ClassifierResult | null> {
  if (!router?.chat) return null;
  const timeout = config?.timeout ?? DEFAULT_CLASSIFIER.timeout;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await router.chat(
      {
        systemInstruction: { parts: [{ text: buildClassifierPrompt(shellKind, cwd) }] },
        contents: [{ role: 'user', parts: [{ text: `Is this command safe to execute?\n\n${command}` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 200,
        },
      },
      config?.model,
      controller.signal,
    );
    return parseClassifierResponse(response.content as Content | undefined);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function resolveClassifierDecision(
  result: ClassifierResult | null,
  config?: TerminalClassifierConfig,
): { allow: boolean; reason: string } {
  const threshold = config?.confidenceThreshold ?? DEFAULT_CLASSIFIER.confidenceThreshold;
  const fallback = config?.fallbackPolicy ?? DEFAULT_CLASSIFIER.fallbackPolicy;

  if (!result) {
    return {
      allow: fallback === 'allow',
      reason: `分类器无法判定，兜底策略: ${fallback}`,
    };
  }

  if (result.safe && result.confidence >= threshold) {
    return { allow: true, reason: result.reason };
  }
  if (!result.safe && result.confidence >= threshold) {
    return { allow: false, reason: result.reason };
  }
  return {
    allow: fallback === 'allow',
    reason: `置信度不足 (${result.confidence.toFixed(2)}, 阈值 ${threshold}): ${result.reason}。兜底策略: ${fallback}`,
  };
}
