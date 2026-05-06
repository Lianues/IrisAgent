import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ExtensionDistributionMode,
  ExtensionInstallFallbackReason,
  ExtensionManifest,
  InstalledExtensionResult,
} from '../manifest.js';
import {
  collectRelativeFilesFromDir,
  cleanupTempInstallDir,
  createTempInstallDir,
  ensureDirectory,
  isDirectory,
} from './fs-utils.js';
import { cloneGitRepository, formatGitExtensionTarget, readGitInstallMetadata, resolveGitExtensionTarget, writeGitInstallMetadata, type GitCommandRunner, type GitExtensionTarget, type GitInstallMetadata } from './git.js';
import { MANIFEST_FILE, readManifestFromDir } from './manifest.js';
import { normalizeRelativeFilePath, normalizeRequestedExtensionPath, resolveSafeRelativePath } from './paths.js';
import { analyzeRuntimeEntries, describeRuntimeIssues } from './runtime-analysis.js';
import {
  buildRemoteExtensionFileUrl,
  buildRemoteExtensionPath,
  fetchBuffer,
  fetchRemoteIndex,
  fetchRemoteManifest,
  getRemoteDistributionFiles,
  getRemoteExtensionIndexUrl as getRemoteExtensionIndexUrlShared,
  type RemoteExtensionOptions,
} from './remote.js';
import { getInstalledExtensionsDir as getDefaultInstalledExtensionsDir, resolveRuntimeDataDir } from './runtime-paths.js';
import { DISABLED_MARKER_FILE } from './types.js';

export interface ExtensionInstallOptions extends RemoteExtensionOptions {
  installedExtensionsDir?: string;
  localExtensionsDir?: string;
}

/**
 * 安装/删除/升级扩展的目标范围。
 *
 * - `global`  → 写入 ~/.iris/extensions/，所有 agent 共享可见。
 * - `agent`   → 写入 ~/.iris/agents/<agentName>/extensions/，仅该 agent 可见，
 *               同名时覆盖全局/embedded 版本。
 */
export type InstallScope =
  | { kind: 'global' }
  | { kind: 'agent'; agentName: string };

/** 把 InstallScope 解析成 extension 安装目录绝对路径。 */
export function resolveScopeInstallDir(scope: InstallScope): string {
  if (scope.kind === 'global') return getDefaultInstalledExtensionsDir();
  return path.join(resolveRuntimeDataDir(), 'agents', scope.agentName, 'extensions');
}

/** 把 InstallScope 解析成对应层 plugins.yaml 路径。 */
export function resolveScopePluginsYamlPath(scope: InstallScope): string {
  if (scope.kind === 'global') return path.join(resolveRuntimeDataDir(), 'configs', 'plugins.yaml');
  return path.join(resolveRuntimeDataDir(), 'agents', scope.agentName, 'configs', 'plugins.yaml');
}

export interface GitExtensionInstallOptions {
  installedExtensionsDir?: string;
  ref?: string;
  subdir?: string;
  commandRunner?: GitCommandRunner;
}

export interface GitExtensionUpdateOptions extends GitExtensionInstallOptions {}

export interface GitExtensionUpdatePreviewResult {
  name: string;
  currentVersion: string;
  nextVersion: string;
  currentCommit?: string;
  nextCommit?: string;
  gitUrl: string;
  gitRef?: string;
  gitSubdir?: string;
  sameCommit: boolean;
  distributionMode: ExtensionDistributionMode;
  runnableEntries: string[];
}

interface LocalExtensionSource {
  manifest: ExtensionManifest;
  rootDir: string;
}

type RemoteInstallFailureKind = 'remote_source_unavailable' | ExtensionInstallFallbackReason;

class RemoteInstallError extends Error {
  constructor(
    readonly kind: RemoteInstallFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteInstallError';
  }
}

function getInstalledExtensionsDir(options?: { installedExtensionsDir?: string }): string {
  return path.resolve(options?.installedExtensionsDir || getDefaultInstalledExtensionsDir());
}

function getLocalExtensionsDir(options?: ExtensionInstallOptions): string {
  return path.resolve(options?.localExtensionsDir || path.join(process.cwd(), 'extensions'));
}

export function getRemoteExtensionIndexUrl(options?: ExtensionInstallOptions): string {
  return getRemoteExtensionIndexUrlShared(options);
}

function asExtensionManifest(manifest: unknown): ExtensionManifest | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  const m = manifest as Partial<ExtensionManifest>;
  if (typeof m.name !== 'string' || !m.name.trim()) return undefined;
  if (typeof m.version !== 'string' || !m.version.trim()) return undefined;
  return m as ExtensionManifest;
}

export interface ValidatedInstallableExtensionResult {
  distributionMode: 'bundled';
  runnableEntries: string[];
}

export function assertInstallableExtensionPackage(
  extensionDir: string,
  manifest: ExtensionManifest,
): ValidatedInstallableExtensionResult {
  const analyses = analyzeRuntimeEntries(collectRelativeFilesFromDir(extensionDir), manifest);
  const issues = analyses.filter((item) => item.needsBuild);

  if (issues.length > 0) {
    throw new Error(`这不是可直接安装的发行包：${describeRuntimeIssues(issues)}`);
  }

  return {
    distributionMode: 'bundled',
    runnableEntries: analyses.flatMap((item) => item.runnableAlternatives),
  };
}

export function copyExtensionDirectory(sourceDir: string, targetDir: string): void {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== 'node_modules',
  });
}

function finalizeInstall(
  tempDir: string,
  manifest: ExtensionManifest,
  requested: string,
  source: 'remote' | 'local' | 'git',
  extras: {
    distributionMode?: ExtensionDistributionMode;
    remotePath?: string;
    sourceDir?: string;
    fallbackReason?: ExtensionInstallFallbackReason;
    fallbackDetail?: string;
    gitUrl?: string;
    gitRef?: string;
    gitCommit?: string;
    gitSubdir?: string;
  },
  installedRootDir: string,
): InstalledExtensionResult {
  const targetDir = path.join(installedRootDir, manifest.name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.renameSync(tempDir, targetDir);

  return {
    source,
    requested,
    name: manifest.name,
    version: manifest.version,
    targetDir,
    distributionMode: extras.distributionMode,
    remotePath: extras.remotePath,
    sourceDir: extras.sourceDir,
    fallbackReason: extras.fallbackReason,
    fallbackDetail: extras.fallbackDetail,
    gitUrl: extras.gitUrl,
    gitRef: extras.gitRef,
    gitCommit: extras.gitCommit,
    gitSubdir: extras.gitSubdir,
  };
}

function isPathLike(requested: string): boolean {
  return requested.includes('/') || requested.includes('\\') || requested.startsWith('.');
}

function resolveLocalSourceByRelativePath(requested: string, localExtensionsDir: string): LocalExtensionSource | undefined {
  if (!isPathLike(requested) || path.isAbsolute(requested)) return undefined;
  try {
    const candidateDir = resolveSafeRelativePath(localExtensionsDir, requested);
    if (!isDirectory(candidateDir)) return undefined;
    const manifest = asExtensionManifest(readManifestFromDir(candidateDir));
    if (!manifest) return undefined;
    return { manifest, rootDir: candidateDir };
  } catch {
    return undefined;
  }
}

function findLocalExtensionSource(requested: string, localExtensionsDir: string): LocalExtensionSource | undefined {
  if (!isDirectory(localExtensionsDir)) return undefined;

  const directSource = resolveLocalSourceByRelativePath(requested, localExtensionsDir);
  if (directSource) return directSource;

  for (const entry of fs.readdirSync(localExtensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rootDir = path.join(localExtensionsDir, entry.name);
    const manifest = asExtensionManifest(readManifestFromDir(rootDir));
    if (!manifest) continue;
    if (entry.name === requested || manifest.name === requested) {
      return { manifest, rootDir };
    }
  }

  return undefined;
}

async function installRemoteExtensionFromIndex(
  requestedPath: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');
  const remotePath = buildRemoteExtensionPath(requested, options);
  const installedRootDir = getInstalledExtensionsDir(options);
  ensureDirectory(installedRootDir);
  const tempDir = createTempInstallDir(installedRootDir);

  try {
    let remoteIndex: string[];
    try {
      remoteIndex = await fetchRemoteIndex(options);
    } catch (err) {
      throw new RemoteInstallError(
        'remote_source_unavailable',
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!remoteIndex.includes(requested)) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录不存在: ${remotePath}`);
    }

    const manifest = asExtensionManifest(await fetchRemoteManifest(requested, options));
    if (!manifest) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension manifest 格式无效: ${remotePath}`);
    }
    const files = getRemoteDistributionFiles(manifest);

    ensureDirectory(tempDir);
    fs.writeFileSync(
      path.join(tempDir, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    for (const relativePath of files) {
      const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
      if (normalizedRelativePath === MANIFEST_FILE) continue;
      const destination = resolveSafeRelativePath(tempDir, normalizedRelativePath);
      ensureDirectory(path.dirname(destination));
      fs.writeFileSync(destination, await fetchBuffer(buildRemoteExtensionFileUrl(requested, normalizedRelativePath, options), 'extension 文件'));
    }

    const installedManifest = asExtensionManifest(readManifestFromDir(tempDir));
    if (!installedManifest) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录缺少 manifest.json: ${remotePath}`);
    }

    const validated = assertInstallableExtensionPackage(tempDir, installedManifest);
    return finalizeInstall(tempDir, installedManifest, requested, 'remote', {
      distributionMode: validated.distributionMode,
      remotePath,
    }, installedRootDir);
  } catch (err) {
    cleanupTempInstallDir(tempDir);
    throw err;
  }
}

export async function installLocalExtension(
  requestedName: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedName, 'extension 名称或路径');
  const localExtensionsDir = getLocalExtensionsDir(options);
  const installedRootDir = getInstalledExtensionsDir(options);
  ensureDirectory(installedRootDir);
  const source = findLocalExtensionSource(requested, localExtensionsDir);

  if (!source) {
    throw new Error(`本地 extension 目录中未找到: ${requested}`);
  }

  const tempDir = createTempInstallDir(installedRootDir);
  try {
    copyExtensionDirectory(source.rootDir, tempDir);
    const manifest = asExtensionManifest(readManifestFromDir(tempDir));
    if (!manifest) {
      throw new Error(`本地 extension 缺少有效 manifest.json: ${source.rootDir}`);
    }

    const validated = assertInstallableExtensionPackage(tempDir, manifest);

    return finalizeInstall(tempDir, manifest, requested, 'local', {
      distributionMode: validated.distributionMode,
      sourceDir: source.rootDir,
    }, installedRootDir);
  } catch (err) {
    cleanupTempInstallDir(tempDir);
    throw err;
  }
}

function copyGitExtensionDirectory(sourceDir: string, targetDir: string): void {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const basename = path.basename(sourcePath);
      return basename !== '.git' && basename !== 'node_modules';
    },
  });
}

interface GitInstallTargetContext {
  expectedName?: string;
  existingMetadata?: GitInstallMetadata;
  preserveDisabledMarker?: boolean;
}

function findInstalledExtensionByName(
  name: string,
  installedRootDir: string,
): LocalExtensionSource | undefined {
  const requested = normalizeRequestedExtensionPath(name, 'extension 名称');

  try {
    const candidateDir = resolveSafeRelativePath(installedRootDir, requested);
    if (isDirectory(candidateDir)) {
      const manifest = asExtensionManifest(readManifestFromDir(candidateDir));
      if (manifest) return { manifest, rootDir: candidateDir };
    }
  } catch {
    // ignore and continue scanning
  }

  if (!isDirectory(installedRootDir)) return undefined;
  for (const entry of fs.readdirSync(installedRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rootDir = path.join(installedRootDir, entry.name);
    const manifest = asExtensionManifest(readManifestFromDir(rootDir));
    if (!manifest) continue;
    if (entry.name === requested || manifest.name === requested) {
      return { manifest, rootDir };
    }
  }

  return undefined;
}

async function installGitTarget(
  target: GitExtensionTarget,
  options?: GitExtensionInstallOptions,
  context: GitInstallTargetContext = {},
): Promise<InstalledExtensionResult> {
  const installedRootDir = getInstalledExtensionsDir(options);
  ensureDirectory(installedRootDir);
  const tempRootDir = createTempInstallDir(installedRootDir);
  const cloneDir = path.join(tempRootDir, 'repo');
  const packageDir = path.join(tempRootDir, 'package');

  try {
    const cloned = await cloneGitRepository(target, cloneDir, {
      commandRunner: options?.commandRunner,
    });
    const sourceDir = target.subdir
      ? resolveSafeRelativePath(cloneDir, target.subdir)
      : cloneDir;

    if (!isDirectory(sourceDir)) {
      throw new Error(`Git 仓库中未找到 extension 目录: ${target.subdir ?? '.'}`);
    }

    copyGitExtensionDirectory(sourceDir, packageDir);
    const manifest = asExtensionManifest(readManifestFromDir(packageDir));
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`);
    }
    if (context.expectedName && manifest.name !== context.expectedName) {
      throw new Error(`Git extension manifest.name 不匹配：期望 ${context.expectedName}，实际 ${manifest.name}`);
    }

    const validated = assertInstallableExtensionPackage(packageDir, manifest);
    writeGitInstallMetadata(packageDir, target, cloned.commit, {
      installedAt: context.existingMetadata?.installedAt,
      updatedAt: context.existingMetadata ? new Date().toISOString() : undefined,
    });

    const targetDir = path.join(installedRootDir, manifest.name);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(packageDir, targetDir);
    if (context.preserveDisabledMarker) {
      fs.writeFileSync(path.join(targetDir, DISABLED_MARKER_FILE), 'disabled\n', 'utf8');
    }

    return {
      source: 'git',
      requested: formatGitExtensionTarget(target),
      name: manifest.name,
      version: manifest.version,
      targetDir,
      distributionMode: validated.distributionMode,
      gitUrl: target.url,
      gitRef: target.ref,
      gitCommit: cloned.commit,
      gitSubdir: target.subdir,
    };
  } finally {
    cleanupTempInstallDir(tempRootDir);
  }
}

export async function installGitExtension(
  gitTargetInput: string,
  options?: GitExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const target = resolveGitExtensionTarget(gitTargetInput, {
    ref: options?.ref,
    subdir: options?.subdir,
  });
  return installGitTarget(target, options);
}

export async function updateGitExtension(
  installedName: string,
  options?: GitExtensionUpdateOptions,
): Promise<InstalledExtensionResult> {
  const installedRootDir = getInstalledExtensionsDir(options);
  const installed = findInstalledExtensionByName(installedName, installedRootDir);
  if (!installed) {
    throw new Error(`未找到已安装 extension: ${installedName}`);
  }

  const metadata = readGitInstallMetadata(installed.rootDir);
  if (!metadata) {
    throw new Error(`extension "${installed.manifest.name}" 不是通过 Git 安装的，无法按 Git 来源升级`);
  }

  const target = resolveGitExtensionTarget(metadata.url, {
    ref: options?.ref ?? metadata.ref,
    subdir: options?.subdir ?? metadata.subdir,
  });
  const preserveDisabledMarker = fs.existsSync(path.join(installed.rootDir, DISABLED_MARKER_FILE));
  return installGitTarget(target, options, {
    expectedName: installed.manifest.name,
    existingMetadata: metadata,
    preserveDisabledMarker,
  });
}

export async function inspectGitExtensionUpdate(
  installedName: string,
  options?: GitExtensionUpdateOptions,
): Promise<GitExtensionUpdatePreviewResult> {
  const installedRootDir = getInstalledExtensionsDir(options);
  const installed = findInstalledExtensionByName(installedName, installedRootDir);
  if (!installed) {
    throw new Error(`未找到已安装 extension: ${installedName}`);
  }

  const metadata = readGitInstallMetadata(installed.rootDir);
  if (!metadata) {
    throw new Error(`extension "${installed.manifest.name}" 不是通过 Git 安装的，无法按 Git 来源检查升级`);
  }

  const target = resolveGitExtensionTarget(metadata.url, {
    ref: options?.ref ?? metadata.ref,
    subdir: options?.subdir ?? metadata.subdir,
  });
  const tempRootDir = createTempInstallDir(installedRootDir);
  const cloneDir = path.join(tempRootDir, 'repo');
  const packageDir = path.join(tempRootDir, 'package');

  try {
    const cloned = await cloneGitRepository(target, cloneDir, {
      commandRunner: options?.commandRunner,
    });
    const sourceDir = target.subdir
      ? resolveSafeRelativePath(cloneDir, target.subdir)
      : cloneDir;
    if (!isDirectory(sourceDir)) {
      throw new Error(`Git 仓库中未找到 extension 目录: ${target.subdir ?? '.'}`);
    }

    copyGitExtensionDirectory(sourceDir, packageDir);
    const manifest = asExtensionManifest(readManifestFromDir(packageDir));
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`);
    }
    if (manifest.name !== installed.manifest.name) {
      throw new Error(`Git extension manifest.name 不匹配：期望 ${installed.manifest.name}，实际 ${manifest.name}`);
    }

    const validated = assertInstallableExtensionPackage(packageDir, manifest);
    return {
      name: manifest.name,
      currentVersion: installed.manifest.version,
      nextVersion: manifest.version,
      currentCommit: metadata.commit,
      nextCommit: cloned.commit,
      gitUrl: target.url,
      gitRef: target.ref,
      gitSubdir: target.subdir,
      sameCommit: !!metadata.commit && metadata.commit === cloned.commit,
      distributionMode: validated.distributionMode,
      runnableEntries: validated.runnableEntries,
    };
  } finally {
    cleanupTempInstallDir(tempRootDir);
  }
}

export function deleteInstalledExtension(
  installedName: string,
  options?: { installedExtensionsDir?: string },
): { name: string; targetDir: string } {
  const installedRootDir = getInstalledExtensionsDir(options);
  const installed = findInstalledExtensionByName(installedName, installedRootDir);
  if (!installed) {
    throw new Error(`未找到已安装 extension: ${installedName}`);
  }

  fs.rmSync(installed.rootDir, { recursive: true, force: true });
  return { name: installed.manifest.name, targetDir: installed.rootDir };
}

export async function installExtension(
  requestedPath: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');

  try {
    return await installRemoteExtensionFromIndex(requested, options);
  } catch (err) {
    if (!(err instanceof RemoteInstallError)) {
      throw err;
    }

    if (err.kind === 'remote_source_unavailable') {
      throw new Error(`远程 extension 仓库不可用: ${err.message}`);
    }

    try {
      const localInstalled = await installLocalExtension(requested, options);
      return {
        ...localInstalled,
        fallbackReason: err.kind,
        fallbackDetail: err.message,
      };
    } catch (localErr) {
      const localMessage = localErr instanceof Error ? localErr.message : String(localErr);
      throw new Error(`远程 extension 目录不存在，且本地安装也失败：${err.message}；${localMessage}`);
    }
  }
}
