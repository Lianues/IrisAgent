import type { InstalledExtensionResult } from 'irises-extension-sdk';
import { isGitExtensionUrlLike } from 'irises-extension-sdk/utils';
import { installExtension, installGitExtension, installLocalExtension, updateGitExtension } from './installer';

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
}

const HELP_TEXT = `
Iris Extension 命令

用法:
  iris extension                      打开插件安装与管理界面
  iris extension install <path>       从远程仓库的 extensions/<path>/ 安装；远程不存在时回退到本地 extension 目录
  iris extension install-git <url>    从 Git 仓库安装 extension 发行包
  iris extension install-local <name> 仅从本地 extension 目录安装
  iris extension update <name>        按已记录的 Git 来源拉取并升级 extension
  iris extension <path>               install 的简写
  iris extension <git-url>            install-git 的简写
  iris ext install <path>             extension 的简写别名
  iris ext <path>                     install 的最简写法

说明:
  - install 支持这些写法：aaa、group/aaa、extensions/aaa
  - install-git 支持 --ref <branch/tag/commit> 与 --subdir <repo/path>
  - install-git 也支持片段写法：https://github.com/user/repo.git#main:extensions/demo
  - update 仅支持通过 install-git / TUI Git 安装的 extension，并会复用安装时记录的 Git URL/ref/subdir；也可用 --ref / --subdir 临时覆盖
  - 安装目标目录：~/.iris/extensions/<manifest.name>/
  - install 会优先从远程仓库的 extensions/index.json 读取扩展路径，再按各扩展目录自己的 manifest.json 下载目标 extension 文件夹；仅当远程不存在该目录时，才尝试本地安装
  - extension 必须自带可运行入口（例如 dist/index.mjs）才允许安装
  - 若 extension 只包含源码、缺少可运行入口，则会直接报错：这不是可直接安装的发行包
  - install-local 只会从当前仓库根目录 ./extensions/ 查找并安装
  - 可通过环境变量 IRIS_EXTENSION_REMOTE_INDEX_URL 和 IRIS_EXTENSION_REMOTE_RAW_BASE_URL 覆盖远程 index 与原始文件地址
`.trim();

export function isExtensionCommandNamespace(value: string | undefined): boolean {
  return !!value && EXTENSION_COMMAND_NAMES.has(value);
}

function parseTargetAndOptions(args: string[]): { target?: string; ref?: string; subdir?: string } {
  let target: string | undefined;
  let ref: string | undefined;
  let subdir: string | undefined;

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
    if (!target && !arg.startsWith('-')) {
      target = arg;
    }
  }

  return { target, ref, subdir };
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
      target: parsed.target,
      ref: parsed.ref,
      subdir: parsed.subdir,
    };
  }

  if (INSTALL_GIT_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return {
      namespace,
      action: 'install-git',
      target: parsed.target,
      ref: parsed.ref,
      subdir: parsed.subdir,
    };
  }

  if (INSTALL_LOCAL_COMMAND_NAMES.has(subcommand)) {
    return {
      namespace,
      action: 'install-local',
      target: rest[1],
    };
  }

  if (UPDATE_COMMAND_NAMES.has(subcommand)) {
    const parsed = parseTargetAndOptions(rest.slice(1));
    return {
      namespace,
      action: 'update',
      target: parsed.target,
      ref: parsed.ref,
      subdir: parsed.subdir,
    };
  }

  if (!subcommand.startsWith('-')) {
    const parsed = parseTargetAndOptions(rest);
    return {
      namespace,
      action: parsed.target && isGitExtensionUrlLike(parsed.target) ? 'install-git' : 'install',
      target: parsed.target,
      ref: parsed.ref,
      subdir: parsed.subdir,
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

  if (result.remotePath) {
    console.log(`- 远程目录: ${result.remotePath}`);
  }
  if (result.sourceDir) {
    console.log(`- 本地来源: ${result.sourceDir}`);
  }
  if (result.gitUrl) {
    console.log(`- Git 地址: ${result.gitUrl}`);
  }
  if (result.gitRef) {
    console.log(`- Git ref: ${result.gitRef}`);
  }
  if (result.gitCommit) {
    console.log(`- Git commit: ${result.gitCommit}`);
  }
  if (result.gitSubdir) {
    console.log(`- Git 子目录: ${result.gitSubdir}`);
  }
  if (result.fallbackReason === 'remote_path_not_found' && result.fallbackDetail) {
    console.log(`- 回退原因: 远程目录不存在：${result.fallbackDetail}`);
  }
  if (result.distributionMode) {
    console.log(`- 分发形态: ${result.distributionMode}`);
  }
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

  const result = parsed.action === 'install'
    ? await installExtension(parsed.target)
    : parsed.action === 'install-git'
      ? await installGitExtension(parsed.target, { ref: parsed.ref, subdir: parsed.subdir })
      : parsed.action === 'update'
        ? await updateGitExtension(parsed.target, { ref: parsed.ref, subdir: parsed.subdir })
        : await installLocalExtension(parsed.target);

  printInstalledSummary(result, parsed.action === 'update' ? '升级' : '安装');
}
