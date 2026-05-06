import * as readline from 'readline';
import type { InstalledExtensionResult } from 'irises-extension-sdk';
import { isGitExtensionUrlLike } from 'irises-extension-sdk/utils';
import {
  installExtension,
  installGitExtension,
  installLocalExtension,
  updateGitExtension,
  resolveScopeInstallDir,
  type InstallScope,
} from './installer';
import { loadAgentDefinitions } from '../agents/registry';

const EXTENSION_COMMAND_NAMES = new Set(['extension', 'extensions', 'ext']);
const INSTALL_COMMAND_NAMES = new Set(['install', 'i']);
const INSTALL_GIT_COMMAND_NAMES = new Set(['install-git', 'git', 'ig']);
const INSTALL_LOCAL_COMMAND_NAMES = new Set(['install-local', 'local', 'il']);
const UPDATE_COMMAND_NAMES = new Set(['update', 'upgrade', 'up']);
const HELP_COMMAND_NAMES = new Set(['-h', '--help', 'help']);

export interface ParsedExtensionCommand {
  namespace: string;
  action: 'install' | 'install-local' | 'install-git' | 'update' | 'help';
  target?: string;
  ref?: string;
  subdir?: string;
  /** 安装目标范围；undefined 表示未通过命令行指定，需走交互式选择。 */
  scope?: InstallScope;
}

const HELP_TEXT = `
Iris Extension 命令

用法:
  iris extension                              打开插件安装与管理界面
  iris extension install <path>               从远程仓库的 extensions/<path>/ 安装；远程不存在时回退到本地
  iris extension install-git <url>            从 Git 仓库安装 extension 发行包
  iris extension install-local <name>         仅从本地 extension 目录安装
  iris extension update <name>                按已记录的 Git 来源拉取并升级 extension
  iris extension <path>                       install 的简写
  iris extension <git-url>                    install-git 的简写

安装范围（可选；不传则交互式选择）:
  --global, -g                                安装到 ~/.iris/extensions/，所有 agent 共享
  --agent <name>, -A <name>                   安装到 ~/.iris/agents/<name>/extensions/，仅该 agent 可见

示例:
  iris extension install foo --global
  iris extension install-git https://github.com/x/y.git --agent my-agent
  iris extension update foo --agent my-agent

说明:
  - install 支持这些写法：aaa、group/aaa、extensions/aaa
  - install-git 支持 --ref <branch/tag/commit> 与 --subdir <repo/path>
  - install-git 也支持片段写法：https://github.com/user/repo.git#main:extensions/demo
  - update 仅支持通过 install-git / TUI Git 安装的 extension；可用 --ref / --subdir 临时覆盖
  - extension 必须自带可运行入口（例如 dist/index.mjs）才允许安装
  - install-local 只会从当前仓库根目录 ./extensions/ 查找并安装
  - agent-installed 扩展优先级高于全局，可就近覆盖同名扩展
  - 可通过 IRIS_EXTENSION_REMOTE_INDEX_URL / IRIS_EXTENSION_REMOTE_RAW_BASE_URL 覆盖远程地址
`.trim();

export function isExtensionCommandNamespace(value: string | undefined): boolean {
  return !!value && EXTENSION_COMMAND_NAMES.has(value);
}

interface ParsedFlags {
  target?: string;
  ref?: string;
  subdir?: string;
  scope?: InstallScope;
}

function parseTargetAndOptions(args: string[]): ParsedFlags {
  let target: string | undefined;
  let ref: string | undefined;
  let subdir: string | undefined;
  let scope: InstallScope | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ref' || arg === '--branch' || arg === '-r') {
      ref = args[++i];
      continue;
    }
    if (arg.startsWith('--ref=')) {
      ref = arg.slice('--ref='.length);
      continue;
    }
    if (arg.startsWith('--branch=')) {
      ref = arg.slice('--branch='.length);
      continue;
    }
    if (arg === '--subdir' || arg === '--dir' || arg === '-s') {
      subdir = args[++i];
      continue;
    }
    if (arg.startsWith('--subdir=')) {
      subdir = arg.slice('--subdir='.length);
      continue;
    }
    if (arg.startsWith('--dir=')) {
      subdir = arg.slice('--dir='.length);
      continue;
    }
    if (arg === '--global' || arg === '-g') {
      scope = { kind: 'global' };
      continue;
    }
    if (arg === '--agent' || arg === '-A') {
      const name = args[++i]?.trim();
      if (!name) throw new Error('--agent 需要指定 agent 名称');
      scope = { kind: 'agent', agentName: name };
      continue;
    }
    if (arg.startsWith('--agent=')) {
      const name = arg.slice('--agent='.length).trim();
      if (!name) throw new Error('--agent= 需要指定 agent 名称');
      scope = { kind: 'agent', agentName: name };
      continue;
    }
    if (!target && !arg.startsWith('-')) {
      target = arg;
    }
  }

  return { target, ref, subdir, scope };
}

export function parseExtensionCommandArgs(args: string[]): ParsedExtensionCommand | undefined {
  const namespace = args[0];
  if (!isExtensionCommandNamespace(namespace)) return undefined;

  const rest = args.slice(1);
  if (rest.length === 0 || HELP_COMMAND_NAMES.has(rest[0])) {
    return { namespace, action: 'help' };
  }

  const subcommand = rest[0];
  if (INSTALL_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return {
      namespace,
      action: parsed.target && isGitExtensionUrlLike(parsed.target) ? 'install-git' : 'install',
      ...parsed,
    };
  }

  if (INSTALL_GIT_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return { namespace, action: 'install-git', ...parsed };
  }

  if (INSTALL_LOCAL_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return { namespace, action: 'install-local', ...parsed };
  }

  if (UPDATE_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return { namespace, action: 'update', ...parsed };
  }

  if (!subcommand.startsWith('-')) {
    const parsed = parseTargetAndOptions(rest);
    return {
      namespace,
      action: parsed.target && isGitExtensionUrlLike(parsed.target) ? 'install-git' : 'install',
      ...parsed,
    };
  }

  return { namespace, action: 'help' };
}

function printInstalledSummary(result: InstalledExtensionResult, verb = '安装'): void {
  console.log(`extension ${verb}完成`);
  console.log(`- 名称: ${result.name}`);
  console.log(`- 版本: ${result.version}`);
  console.log(`- 来源: ${result.source}`);
  console.log(`- 目录: ${result.targetDir}`);

  if (result.remotePath) console.log(`- 远程目录: ${result.remotePath}`);
  if (result.sourceDir) console.log(`- 本地来源: ${result.sourceDir}`);
  if (result.gitUrl) console.log(`- Git 地址: ${result.gitUrl}`);
  if (result.gitRef) console.log(`- Git ref: ${result.gitRef}`);
  if (result.gitCommit) console.log(`- Git commit: ${result.gitCommit}`);
  if (result.gitSubdir) console.log(`- Git 子目录: ${result.gitSubdir}`);
  if (result.fallbackReason === 'remote_path_not_found' && result.fallbackDetail) {
    console.log(`- 回退原因: 远程目录不存在：${result.fallbackDetail}`);
  }
  if (result.distributionMode) console.log(`- 分发形态: ${result.distributionMode}`);
}

/**
 * 在 TTY 下交互式让用户选择安装范围（全局 / 某 agent）。
 *
 * 非 TTY 环境会直接抛错，要求用户用 --global / --agent 显式指定。
 */
async function promptInstallScope(actionLabel: string): Promise<InstallScope> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `当前不是交互式终端，无法选择安装范围。请用 --global 或 --agent <name> 显式指定。`,
    );
  }

  const agents = loadAgentDefinitions();
  const choices: Array<{ label: string; scope: InstallScope }> = [
    { label: '全局 (~/.iris/extensions/)', scope: { kind: 'global' } },
    ...agents.map((a) => ({
      label: `agent: ${a.name}${a.description ? ` — ${a.description}` : ''}`,
      scope: { kind: 'agent' as const, agentName: a.name },
    })),
  ];

  if (choices.length === 1) {
    console.log(`未配置任何 agent，将默认${actionLabel}到全局 (~/.iris/extensions/)。`);
    return { kind: 'global' };
  }

  console.log(`请选择${actionLabel}范围：`);
  choices.forEach((c, i) => console.log(`  [${i + 1}] ${c.label}`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`输入序号 (1-${choices.length})，回车默认 1: `, resolve);
      });
      const trimmed = answer.trim();
      const idx = trimmed === '' ? 1 : Number.parseInt(trimmed, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
        return choices[idx - 1].scope;
      }
      console.log(`无效输入，请输入 1-${choices.length} 之间的序号。`);
    }
  } finally {
    rl.close();
  }
}

function describeScope(scope: InstallScope): string {
  return scope.kind === 'global' ? '全局 (~/.iris/extensions/)' : `agent "${scope.agentName}"`;
}

export async function runExtensionCommand(args: string[]): Promise<void> {
  const parsed = parseExtensionCommandArgs(args);
  if (!parsed) {
    throw new Error('当前参数不是 extension 命令');
  }

  if (parsed.action === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  if (!parsed.target?.trim()) {
    const label = parsed.action === 'install' ? 'path' : parsed.action === 'install-git' ? 'url' : 'name';
    throw new Error(`缺少 ${label} 参数。\n\n${HELP_TEXT}`);
  }

  // scope 解析：CLI 未指定时走交互式选择
  const actionLabel = parsed.action === 'update' ? '升级' : '安装';
  const scope = parsed.scope ?? (await promptInstallScope(actionLabel));
  const installedExtensionsDir = resolveScopeInstallDir(scope);

  console.log(`将${actionLabel}到：${describeScope(scope)}`);

  const result = parsed.action === 'install'
    ? await installExtension(parsed.target, { installedExtensionsDir })
    : parsed.action === 'install-git'
      ? await installGitExtension(parsed.target, { ref: parsed.ref, subdir: parsed.subdir, installedExtensionsDir })
      : parsed.action === 'update'
        ? await updateGitExtension(parsed.target, { ref: parsed.ref, subdir: parsed.subdir, installedExtensionsDir })
        : await installLocalExtension(parsed.target, { installedExtensionsDir });

  printInstalledSummary(result, actionLabel);
}
