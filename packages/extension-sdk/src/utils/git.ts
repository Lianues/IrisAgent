/**
 * Git extension 安装工具。
 *
 * 仅封装“解析 Git 目标 + 调用 git clone/fetch/checkout + 读取 commit”这些
 * 与 core / terminal 都需要共享的最小逻辑。具体 manifest 校验、复制到
 * ~/.iris/extensions/ 的安装流程仍由调用方负责。
 */

import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import * as path from 'node:path';
import { normalizeRelativeFilePath, normalizeText } from './paths.js';

export const GIT_INSTALL_METADATA_FILE = '.iris-extension-install.json';

export interface GitExtensionTarget {
  url: string;
  /** branch / tag / commit，可为空表示默认分支 */
  ref?: string;
  /** extension 位于仓库中的相对目录，可为空表示仓库根目录 */
  subdir?: string;
}

export interface GitInstallMetadata {
  source: 'git';
  url: string;
  ref?: string;
  commit?: string;
  subdir?: string;
  installedAt?: string;
  updatedAt?: string;
}

export interface GitExtensionTargetOptions {
  ref?: string;
  subdir?: string;
}

export interface GitCommandResult {
  stdout?: string;
  stderr?: string;
}

export type GitCommandRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => Promise<GitCommandResult | void> | GitCommandResult | void;

export interface GitCloneRepositoryOptions {
  commandRunner?: GitCommandRunner;
}

export interface GitCloneRepositoryResult {
  target: GitExtensionTarget;
  cloneDir: string;
  commit?: string;
}

function stripGitPlusProtocol(url: string): string {
  return url.startsWith('git+') ? url.slice('git+'.length) : url;
}

export function isGitExtensionUrlLike(value: string | undefined): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  const url = stripGitPlusProtocol(text);
  return /^(https|ssh):\/\//i.test(url) || /^git@[^:]+:.+/i.test(url);
}

export function parseGitExtensionTarget(input: string): GitExtensionTarget {
  const trimmed = normalizeText(input);
  if (!trimmed) {
    throw new Error('Git 地址不能为空');
  }

  let url = trimmed;
  let ref: string | undefined;
  let subdir: string | undefined;

  const hashIndex = trimmed.lastIndexOf('#');
  if (hashIndex >= 0) {
    url = trimmed.slice(0, hashIndex).trim();
    const fragment = trimmed.slice(hashIndex + 1).trim();
    if (fragment) {
      const subdirSeparator = fragment.indexOf(':');
      if (subdirSeparator >= 0) {
        ref = normalizeText(fragment.slice(0, subdirSeparator));
        subdir = normalizeText(fragment.slice(subdirSeparator + 1));
      } else {
        ref = fragment;
      }
    }
  }

  return {
    url: normalizeGitUrl(url),
    ref: normalizeGitRef(ref),
    subdir: normalizeGitSubdir(subdir),
  };
}

export function resolveGitExtensionTarget(
  input: string,
  options: GitExtensionTargetOptions = {},
): GitExtensionTarget {
  const parsed = parseGitExtensionTarget(input);
  return {
    url: parsed.url,
    ref: normalizeGitRef(options.ref) ?? parsed.ref,
    subdir: normalizeGitSubdir(options.subdir) ?? parsed.subdir,
  };
}

export function normalizeGitUrl(input: string): string {
  const trimmed = normalizeText(input);
  if (!trimmed) {
    throw new Error('Git 地址不能为空');
  }

  const normalized = stripGitPlusProtocol(trimmed);
  if (!isGitExtensionUrlLike(normalized)) {
    throw new Error(`不支持的 Git 地址: ${input}。仅支持 https://、ssh:// 或 git@host:repo.git 格式。`);
  }
  return normalized;
}

export function normalizeGitRef(input: string | undefined): string | undefined {
  const ref = normalizeText(input);
  if (!ref) return undefined;
  if (/[\r\n\0]/.test(ref)) {
    throw new Error(`Git ref 无效: ${input}`);
  }
  return ref;
}

export function normalizeGitSubdir(input: string | undefined): string | undefined {
  const text = normalizeText(input);
  if (!text) return undefined;
  return normalizeRelativeFilePath(text.replace(/^\.\//, ''), 'Git extension 子目录');
}

export function formatGitExtensionTarget(target: GitExtensionTarget): string {
  const suffix = target.ref || target.subdir
    ? `#${target.ref ?? ''}${target.subdir ? `:${target.subdir}` : ''}`
    : '';
  return `${target.url}${suffix}`;
}

export function readGitInstallMetadata(rootDir: string): GitInstallMetadata | undefined {
  const metadataPath = path.join(rootDir, GIT_INSTALL_METADATA_FILE);
  if (!fs.existsSync(metadataPath)) return undefined;

  try {
    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    if (raw.source !== 'git') return undefined;
    const url = normalizeText(raw.url);
    if (!url) return undefined;
    return {
      source: 'git',
      url: normalizeGitUrl(url),
      ref: normalizeGitRef(normalizeText(raw.ref)),
      commit: normalizeText(raw.commit),
      subdir: normalizeGitSubdir(normalizeText(raw.subdir)),
      installedAt: normalizeText(raw.installedAt),
      updatedAt: normalizeText(raw.updatedAt),
    };
  } catch {
    return undefined;
  }
}

export function writeGitInstallMetadata(
  rootDir: string,
  target: GitExtensionTarget,
  commit: string | undefined,
  options: { installedAt?: string; updatedAt?: string } = {},
): GitInstallMetadata {
  const metadata: GitInstallMetadata = {
    source: 'git',
    url: target.url,
    ref: target.ref,
    commit,
    subdir: target.subdir,
    installedAt: options.installedAt ?? new Date().toISOString(),
    updatedAt: options.updatedAt,
  };

  fs.writeFileSync(
    path.join(rootDir, GIT_INSTALL_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );

  return metadata;
}

function defaultGitCommandRunner(command: string, args: string[], cwd?: string): GitCommandResult {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    const detail = stderr || stdout || `exit=${result.status}`;
    throw new Error(`Git 命令执行失败: ${command} ${args.join(' ')} (${detail})`);
  }

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : undefined,
    stderr: typeof result.stderr === 'string' ? result.stderr : undefined,
  };
}

async function runGit(
  runner: GitCommandRunner | undefined,
  args: string[],
  cwd?: string,
): Promise<GitCommandResult> {
  const result = await (runner ?? defaultGitCommandRunner)('git', args, cwd);
  return result ?? {};
}

function firstOutputLine(value: string | undefined): string | undefined {
  const line = value?.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line || undefined;
}

export async function cloneGitRepository(
  target: GitExtensionTarget,
  cloneDir: string,
  options: GitCloneRepositoryOptions = {},
): Promise<GitCloneRepositoryResult> {
  const normalizedCloneDir = path.resolve(cloneDir);
  const parentDir = path.dirname(normalizedCloneDir);

  if (target.ref) {
    await runGit(options.commandRunner, ['clone', '--depth=1', '--no-checkout', target.url, normalizedCloneDir], parentDir);
    await runGit(options.commandRunner, ['fetch', '--depth=1', 'origin', target.ref], normalizedCloneDir);
    await runGit(options.commandRunner, ['checkout', '--force', 'FETCH_HEAD'], normalizedCloneDir);
  } else {
    await runGit(options.commandRunner, ['clone', '--depth=1', target.url, normalizedCloneDir], parentDir);
  }

  const rev = await runGit(options.commandRunner, ['rev-parse', 'HEAD'], normalizedCloneDir);
  return {
    target,
    cloneDir: normalizedCloneDir,
    commit: firstOutputLine(rev.stdout),
  };
}
