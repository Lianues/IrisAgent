import fs from "node:fs"
import path from "node:path"
import { parse, stringify } from "yaml"
import {
  normalizeText,
  normalizeRelativeFilePath,
  normalizeRequestedExtensionPath,
  resolveSafeRelativePath,
  MANIFEST_FILE,
  DISABLED_MARKER_FILE,
  readManifestFromDir,
  ensureDirectory,
  createTempInstallDir,
  cleanupTempInstallDir,
  collectRelativeFilesFromDir,
  getInstalledExtensionsDir,
  resolveRuntimeConfigDir,
  fetchBuffer,
  fetchRemoteIndex,
  fetchRemoteManifest,
  buildRemoteExtensionFileUrl,
  getRemoteDistributionFiles,
  analyzeRuntimeEntries,
  describeRuntimeIssues,
  type ExtensionManifestLike,
  cloneGitRepository,
  resolveGitExtensionTarget,
  formatGitExtensionTarget,
  readGitInstallMetadata,
  writeGitInstallMetadata,
  type GitCommandRunner,
  type GitExtensionTarget,
  type GitInstallMetadata,
} from "irises-extension-sdk/utils"
import {
  resolveInstallDirForScope,
  resolvePluginsYamlPathForScope,
  type InstallScope,
} from "../install-dir.js"

// ==================== TUI 专属类型 ====================

interface EditablePluginEntry {
  name: string
  type?: "local" | "npm"
  enabled?: boolean
  priority?: number
  config?: Record<string, unknown>
}

/**
 * 扩展来源：
 *   - installed       = ~/.iris/extensions/<name>            （全局已安装）
 *   - agent-installed = ~/.iris/agents/<id>/extensions/<name>（agent 专属，优先级最高）
 *   - embedded        = <installDir>/extensions/<name> 且 ∈ embedded.json （随发行包内嵌）
 *   - workspace       = <installDir>/extensions/<name> 且 ∉ embedded.json （源码仓库的额外项）
 */
type ExtensionLocalSource = "installed" | "agent-installed" | "embedded" | "workspace"

interface DistributionAnalysis {
  distributionMode: "bundled" | "source"
  distributionLabel: string
  distributionDetail: string
  runnableEntries: string[]
}

export interface ExtensionSummary {
  requestedPath: string
  name: string
  version: string
  description: string
  typeLabel: string
  typeDetail: string
  distributionMode: "bundled" | "source"
  distributionLabel: string
  distributionDetail: string
  runnableEntries: string[]
  hasPlugin: boolean
  hasPlatforms: boolean
  platformCount: number
  installed: boolean
  enabled: boolean
  stateLabel: string
  statusDetail: string
  rootDir?: string
  localSource?: ExtensionLocalSource
  installSource?: "remote" | "local" | "git" | "embedded" | "workspace"
  gitUrl?: string
  gitRef?: string
  gitCommit?: string
  gitSubdir?: string
  localSourceLabel?: string
  localVersion?: string
  localVersionHint?: string
  /** agent-installed 时记录所属 agent 名（用于后续 update/delete 时定位 plugins.yaml） */
  agentName?: string
}

export interface GitExtensionInstallInput {
  url: string
  ref?: string
  subdir?: string
}

export interface GitExtensionRuntimeOptions {
  commandRunner?: GitCommandRunner
}

export interface GitExtensionPreview {
  summary: ExtensionSummary
  target: GitExtensionTarget
  commit?: string
}

export interface GitExtensionUpdatePreview extends GitExtensionPreview {
  current: ExtensionSummary
  previousCommit?: string
  sameCommit: boolean
}

export { getRemoteExtensionRequestTimeoutMs } from "irises-extension-sdk/utils"
export { isGitExtensionUrlLike } from "irises-extension-sdk/utils"

// ==================== TUI 专属工具 ====================

function getEmbeddedExtensionsDir(installDir: string): string {
  return path.join(path.resolve(installDir), "extensions")
}

function getPlatformCount(manifest: ExtensionManifestLike): number {
  return Array.isArray(manifest.platforms)
    ? manifest.platforms.filter((platform) => !!normalizeText(platform?.name) && !!normalizeText(platform?.entry)).length
    : 0
}

function hasPlatformContribution(manifest: ExtensionManifestLike): boolean {
  return getPlatformCount(manifest) > 0
}

function hasPluginContribution(manifest: ExtensionManifestLike): boolean {
  if (manifest.plugin && typeof manifest.plugin === "object") {
    return true
  }

  if (normalizeText(manifest.entry)) {
    return true
  }

  return !hasPlatformContribution(manifest)
}

function buildTypeLabel(manifest: ExtensionManifestLike): string {
  const hasPlugin = hasPluginContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin && platformCount > 0) return "插件 + 平台"
  if (hasPlugin) return "插件"
  if (platformCount > 1) return `${platformCount} 个平台`
  if (platformCount === 1) return "平台"
  return "扩展"
}

function buildTypeDetail(manifest: ExtensionManifestLike): string {
  const hasPlugin = hasPluginContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin && platformCount > 0) {
    return `包含插件入口，并贡献 ${platformCount} 个平台。`
  }
  if (hasPlugin) {
    return "只包含插件入口。"
  }
  if (platformCount > 0) {
    return `只包含平台贡献，共 ${platformCount} 个平台。`
  }
  return "未声明插件入口或平台贡献。"
}

function analyzeDistribution(availableFiles: string[], manifest: ExtensionManifestLike): DistributionAnalysis {
  const analyses = analyzeRuntimeEntries(availableFiles, manifest)
  const issues = analyses.filter((item) => item.needsBuild)
  if (issues.length > 0) {
    return {
      distributionMode: "source",
      distributionLabel: "源码包",
      distributionDetail: `当前包不是可直接安装的发行包：${describeRuntimeIssues(issues)}`,
      runnableEntries: [],
    }
  }

  return {
    distributionMode: "bundled",
    distributionLabel: "可直接安装",
    distributionDetail: "当前包已包含可运行入口，可直接下载安装。",
    runnableEntries: analyses.flatMap((item) => item.runnableAlternatives),
  }
}

// ==================== plugins.yaml 读写 ====================

function readEditablePluginEntries(scope: InstallScope = { kind: "global" }): EditablePluginEntry[] {
  const pluginsPath = resolvePluginsYamlPathForScope(scope)
  if (!fs.existsSync(pluginsPath)) return []

  try {
    const raw = parse(fs.readFileSync(pluginsPath, "utf-8"))
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { plugins?: unknown }).plugins)
        ? (raw as { plugins: unknown[] }).plugins
        : []

    return list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .filter((item) => !!normalizeText(item.name))
      .map((item) => ({
        name: normalizeText(item.name)!,
        type: item.type === "npm" ? "npm" : "local",
        enabled: item.enabled !== false,
        priority: typeof item.priority === "number" ? item.priority : undefined,
        config: item.config && typeof item.config === "object" && !Array.isArray(item.config)
          ? item.config as Record<string, unknown>
          : undefined,
      }))
  } catch {
    return []
  }
}

function writeEditablePluginEntries(entries: EditablePluginEntry[], scope: InstallScope = { kind: "global" }): void {
  const pluginsPath = resolvePluginsYamlPathForScope(scope)
  ensureDirectory(path.dirname(pluginsPath))
  const content = `# 插件配置\n\n${stringify({ plugins: entries }, { indent: 2 })}`
  fs.writeFileSync(pluginsPath, content, "utf-8")
}

function upsertLocalPluginEnabled(name: string, enabled: boolean, scope: InstallScope = { kind: "global" }): void {
  const entries = readEditablePluginEntries(scope)
  const existingIndex = entries.findIndex((entry) => entry.name === name && (entry.type ?? "local") === "local")

  if (existingIndex >= 0) {
    entries[existingIndex] = {
      ...entries[existingIndex],
      type: "local",
      enabled,
    }
  } else {
    entries.push({
      name,
      type: "local",
      enabled,
    })
  }

  writeEditablePluginEntries(entries, scope)
}

function removeLocalPluginEntry(name: string, scope: InstallScope = { kind: "global" }): void {
  const nextEntries = readEditablePluginEntries(scope).filter((entry) => !(entry.name === name && (entry.type ?? "local") === "local"))
  writeEditablePluginEntries(nextEntries, scope)
}

function getPluginEnabledState(name: string, scope: InstallScope = { kind: "global" }): boolean | undefined {
  const entry = readEditablePluginEntries(scope).find((item) => item.name === name && (item.type ?? "local") === "local")
  if (!entry) return undefined
  return entry.enabled !== false
}

/** 将 ExtensionSummary 还原成 InstallScope，用于后续 update/delete/enable/disable 写对应层 plugins.yaml。 */
function scopeFromSummary(summary: ExtensionSummary): InstallScope {
  if (summary.localSource === "agent-installed" && summary.agentName) {
    return { kind: "agent", agentName: summary.agentName }
  }
  return { kind: "global" }
}

// ==================== 安装状态 ====================

function hasDisabledMarker(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE))
}

function setDisabledMarker(rootDir: string, disabled: boolean): void {
  const markerPath = path.join(rootDir, DISABLED_MARKER_FILE)
  if (disabled) {
    fs.writeFileSync(markerPath, "disabled\n", "utf-8")
  } else if (fs.existsSync(markerPath)) {
    fs.rmSync(markerPath, { force: true })
  }
}

function resolveInstalledState(
  manifest: ExtensionManifestLike,
  rootDir: string,
): { enabled: boolean; stateLabel: string; statusDetail: string } {
  const disabled = hasDisabledMarker(rootDir)
  if (disabled) {
    return {
      enabled: false,
      stateLabel: "已关闭",
      statusDetail: "检测到本地禁用标记。运行时将跳过该 extension。",
    }
  }

  const hasPlugin = hasPluginContribution(manifest)
  const hasPlatforms = hasPlatformContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin) {
    const pluginEnabled = getPluginEnabledState(manifest.name!)
    // 自动发现机制下，未在 plugins.yaml 中声明（undefined）视为默认启用；仅显式 false 才关闭
    if (hasPlatforms && pluginEnabled === false) {
      return {
        enabled: false,
        stateLabel: "平台已启用，插件已关闭",
        statusDetail: "平台贡献仍可被注册，插件入口已在 plugins.yaml 中显式关闭。",
      }
    }

    if (!hasPlatforms && pluginEnabled === false) {
      return {
        enabled: false,
        stateLabel: "未启用",
        statusDetail: "该 extension 只包含插件入口，尚未启用。",
      }
    }
  }

  if (hasPlugin && hasPlatforms) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: `插件入口和 ${platformCount} 个平台贡献都会参与运行。`,
    }
  }

  if (hasPlugin) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: "插件入口已启用。",
    }
  }

  if (hasPlatforms) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: `该 extension 只包含 ${platformCount} 个平台贡献，运行时会自动注册。`,
    }
  }

  return {
    enabled: true,
    stateLabel: "已开启",
    statusDetail: "该 extension 未声明插件或平台贡献，但已存在于本地目录中。",
  }
}

// ==================== Summary 构建 ====================

function buildSummary(
  requestedPath: string,
  manifest: ExtensionManifestLike,
  options?: {
    rootDir?: string
    installed?: boolean
    enabled?: boolean
    stateLabel?: string
    statusDetail?: string
    localSource?: ExtensionLocalSource
    installSource?: "remote" | "local" | "git" | "embedded"
    gitUrl?: string
    gitRef?: string
    gitCommit?: string
    gitSubdir?: string
    localSourceLabel?: string
    localVersion?: string
    localVersionHint?: string
    distributionMode?: "bundled" | "source"
    distributionLabel?: string
    distributionDetail?: string
    runnableEntries?: string[]
  },
): ExtensionSummary {
  return {
    requestedPath,
    name: manifest.name!,
    version: manifest.version!,
    description: normalizeText(manifest.description) ?? "无描述",
    typeLabel: buildTypeLabel(manifest),
    typeDetail: buildTypeDetail(manifest),
    distributionMode: options?.distributionMode ?? "source",
    distributionLabel: options?.distributionLabel ?? "源码包",
    distributionDetail: options?.distributionDetail ?? "当前包未经过可运行发行校验。",
    runnableEntries: options?.runnableEntries ?? [],
    hasPlugin: hasPluginContribution(manifest),
    hasPlatforms: hasPlatformContribution(manifest),
    platformCount: getPlatformCount(manifest),
    installed: options?.installed === true,
    enabled: options?.enabled === true,
    stateLabel: options?.stateLabel ?? "未安装",
    statusDetail: options?.statusDetail ?? "当前本地未发现同名 extension。",
    rootDir: options?.rootDir,
    localSource: options?.localSource,
    installSource: options?.installSource,
    gitUrl: options?.gitUrl,
    gitRef: options?.gitRef,
    gitCommit: options?.gitCommit,
    gitSubdir: options?.gitSubdir,
    localSourceLabel: options?.localSourceLabel,
    localVersion: options?.localVersion,
    localVersionHint: options?.localVersionHint,
  }
}

// ==================== 公开 API ====================

/**
 * 加载所有已发现的 extension。
 *
 * 顺序（同名取优先级最高的，后续重名跳过）：
 *   1. agent-installed（仅当 opts.agentExtensionsDir 提供）
 *   2. installed       (~/.iris/extensions/)
 *   3. embedded + workspace（来自 installDir/extensions/，按 embedded.json 二分类）
 *
 * @param installDir   发行包根目录（用于扫描 embedded/workspace）；不传则跳过该层
 * @param opts.agentExtensionsDir 当前 agent 的扩展目录（用于扫描 agent-installed）
 * @param opts.agentName          agent 名（用于在 ExtensionSummary 中记录归属）
 */
export function loadInstalledExtensions(opts?: {
  installDir?: string
  agentExtensionsDir?: string
  agentName?: string
}): ExtensionSummary[] {
  const seen = new Set<string>()
  const results: ExtensionSummary[] = []

  // 1) agent-installed
  if (opts?.agentExtensionsDir) {
    for (const item of scanInstalledDir(opts.agentExtensionsDir, "agent-installed", { kind: "agent", agentName: opts.agentName ?? "" })) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      results.push({ ...item, agentName: opts.agentName })
    }
  }

  // 2) installed (global)
  for (const item of scanInstalledDir(getInstalledExtensionsDir(), "installed", { kind: "global" })) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    results.push(item)
  }

  // 3) embedded + workspace（来自 installDir/extensions/）
  if (opts?.installDir) {
    for (const item of loadEmbeddedAndWorkspaceExtensions(opts.installDir)) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      results.push(item)
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/** 扫描指定目录下的扩展（installed 或 agent-installed）。 */
function scanInstalledDir(installedRootDir: string, source: "installed" | "agent-installed", scope: InstallScope): ExtensionSummary[] {
  if (!fs.existsSync(installedRootDir) || !fs.statSync(installedRootDir).isDirectory()) {
    return []
  }

  const results: ExtensionSummary[] = []
  for (const entry of fs.readdirSync(installedRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const rootDir = path.join(installedRootDir, entry.name)
    const manifest = readManifestFromDir(rootDir)
    if (!manifest) continue
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(rootDir), manifest)

    const installMetadata = readGitInstallMetadata(rootDir)
    const state = resolveInstalledState(manifest, rootDir)
    const sourceLabel = source === "agent-installed" ? "Agent 安装" : "已安装"
    results.push(buildSummary(manifest.name!, manifest, {
      rootDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: source,
      localSourceLabel: sourceLabel,
      installSource: installMetadata?.source,
      gitUrl: installMetadata?.url,
      gitRef: installMetadata?.ref,
      gitCommit: installMetadata?.commit,
      gitSubdir: installMetadata?.subdir,
      localVersion: manifest.version!,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    }))
  }

  return results
}

/**
 * 扫描 installDir/extensions/ 下所有扩展，按 embedded.json 二分类：
 *   - 名字在 embedded.json 里 → source='embedded'
 *   - 否则                      → source='workspace'
 */
function loadEmbeddedAndWorkspaceExtensions(installDir: string): ExtensionSummary[] {
  const embeddedRootDir = getEmbeddedExtensionsDir(installDir)
  if (!fs.existsSync(embeddedRootDir) || !fs.statSync(embeddedRootDir).isDirectory()) return []

  // 读取 embedded.json 名单
  const embeddedNames = new Set<string>()
  const embeddedConfigPath = path.join(embeddedRootDir, "embedded.json")
  if (fs.existsSync(embeddedConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(embeddedConfigPath, "utf-8")) as {
        extensions?: Array<{ name?: string }>
      }
      if (Array.isArray(raw.extensions)) {
        for (const item of raw.extensions) {
          const name = normalizeText(item?.name)
          if (name) embeddedNames.add(name)
        }
      }
    } catch {
      // ignore — embedded.json 解析失败时按全部 workspace 处理
    }
  }

  const results: ExtensionSummary[] = []
  for (const dirent of fs.readdirSync(embeddedRootDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const rootDir = path.join(embeddedRootDir, dirent.name)
    const manifest = readManifestFromDir(rootDir)
    if (!manifest) continue
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(rootDir), manifest)

    const isEmbedded = embeddedNames.has(manifest.name!)
    const source: ExtensionLocalSource = isEmbedded ? "embedded" : "workspace"
    const sourceLabel = isEmbedded ? "源码内嵌" : "源码 workspace"
    const stateLabel = isEmbedded ? "源码内嵌" : "源码 workspace（默认不加载）"
    const statusDetail = isEmbedded
      ? "当前安装目录已内嵌该 extension。若用户目录安装同名版本，运行时将优先加载用户目录版本。"
      : "源码仓库中的额外扩展，默认不被加载。需在 system.yaml 中开启 loadWorkspaceExtensions 才能生效。"

    results.push(buildSummary(manifest.name!, manifest, {
      rootDir,
      installed: false,
      enabled: getPluginEnabledState(manifest.name!) !== false && !hasDisabledMarker(rootDir),
      stateLabel,
      statusDetail,
      localSource: source,
      localSourceLabel: sourceLabel,
      installSource: isEmbedded ? "embedded" : "workspace",
      localVersion: manifest.version!,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    }))
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

function buildLocalVersionHint(summary: ExtensionSummary): string {
  if (summary.localSource === "installed") {
    return `本地已有版本 ${summary.version}（已安装，运行时优先于源码内嵌）`
  }

  if (summary.localSource === "embedded") {
    return `本地已有版本 ${summary.version}（源码内嵌）`
  }

  return `本地已有版本 ${summary.version}`
}

export async function listRemoteExtensions(installDir: string, opts?: {
  agentExtensionsDir?: string
  agentName?: string
}): Promise<ExtensionSummary[]> {
  const remoteIndex = await fetchRemoteIndex()
  const remoteEntries = (await Promise.allSettled(
    remoteIndex.map(async (requestedPath) => {
      const manifest = await fetchRemoteManifest(requestedPath)
      return {
        requestedPath,
        manifest,
        files: getRemoteDistributionFiles(manifest),
      }
    }),
  ))
    .filter((item): item is PromiseFulfilledResult<{ requestedPath: string; manifest: ExtensionManifestLike; files: string[] }> => {
      return item.status === "fulfilled"
    })
    .map((item) => item.value)
  if (remoteIndex.length > 0 && remoteEntries.length === 0) {
    throw new Error("远程 extension manifest 全部读取失败")
  }
  // 收集本地已发现的同名扩展（用于"本地兼容"提示），含 4 类源
  const localMap = new Map(
    loadInstalledExtensions({ installDir, agentExtensionsDir: opts?.agentExtensionsDir, agentName: opts?.agentName })
      .map((item) => [item.name, item])
  )
  const results: ExtensionSummary[] = []
  const seenRequestedPaths = new Set<string>()

  for (const entry of remoteEntries) {
    const requestedPath = entry.requestedPath
    if (seenRequestedPaths.has(requestedPath)) continue

    try {
      const distribution = analyzeDistribution(entry.files, entry.manifest)
      const local = localMap.get(entry.manifest.name!)

      results.push(buildSummary(requestedPath, entry.manifest, local ? {
        installed: local.installed,
        enabled: local.enabled,
        stateLabel: local.stateLabel,
        statusDetail: local.statusDetail,
        localSource: local.localSource,
        localSourceLabel: local.localSourceLabel,
        localVersion: local.version,
        localVersionHint: buildLocalVersionHint(local),
        distributionMode: distribution.distributionMode,
        distributionLabel: distribution.distributionLabel,
        distributionDetail: distribution.distributionDetail,
        runnableEntries: distribution.runnableEntries,
      } : {
        distributionMode: distribution.distributionMode,
        distributionLabel: distribution.distributionLabel,
        distributionDetail: distribution.distributionDetail,
        runnableEntries: distribution.runnableEntries,
      }))
      seenRequestedPaths.add(requestedPath)
    } catch {
      continue
    }
  }

  return results.sort((a, b) => a.requestedPath.localeCompare(b.requestedPath))
}

export async function installRemoteExtension(
  requestedPath: string,
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  const requested = normalizeRequestedExtensionPath(requestedPath, "extension 路径")
  const installedRootDir = resolveInstallDirForScope(scope)
  ensureDirectory(installedRootDir)
  const tempDir = createTempInstallDir(installedRootDir)

  try {
    const remoteIndex = await fetchRemoteIndex()
    if (!remoteIndex.includes(requested)) {
      throw new Error(`远程 extension 目录不存在: ${requested}`)
    }

    const manifest = await fetchRemoteManifest(requested)
    const files = getRemoteDistributionFiles(manifest)

    ensureDirectory(tempDir)
    fs.writeFileSync(
      path.join(tempDir, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    )

    for (const relativePath of files) {
      const normalizedRelativePath = normalizeRelativeFilePath(relativePath)
      if (normalizedRelativePath === MANIFEST_FILE) continue
      const destination = resolveSafeRelativePath(tempDir, normalizedRelativePath)
      ensureDirectory(path.dirname(destination))
      fs.writeFileSync(destination, await fetchBuffer(buildRemoteExtensionFileUrl(requested, normalizedRelativePath), "extension 文件"))
    }

    const installedManifest = readManifestFromDir(tempDir)
    if (!installedManifest) {
      throw new Error(`远程 extension 目录缺少 manifest.json: ${requested}`)
    }

    const distribution = analyzeDistribution(collectRelativeFilesFromDir(tempDir), installedManifest)
    if (distribution.distributionMode !== "bundled") {
      throw new Error(distribution.distributionDetail)
    }

    const targetDir = path.join(installedRootDir, installedManifest.name!)
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.renameSync(tempDir, targetDir)

    if (hasPluginContribution(installedManifest)) {
      upsertLocalPluginEnabled(installedManifest.name!, false, scope)
    }

    const state = resolveInstalledState(installedManifest, targetDir)
    const sourceLabel = scope.kind === "agent" ? "Agent 安装" : "已安装"
    return buildSummary(requested, installedManifest, {
      rootDir: targetDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: scope.kind === "agent" ? "agent-installed" : "installed",
      localSourceLabel: sourceLabel,
      localVersion: installedManifest.version!,
      localVersionHint: `本地已有版本 ${installedManifest.version!}（已安装，运行时优先于源码内嵌）`,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
      agentName: scope.kind === "agent" ? scope.agentName : undefined,
    })
  } catch (error) {
    cleanupTempInstallDir(tempDir)
    throw error
  }
}

type GitExtensionTargetInput = string | GitExtensionInstallInput

function resolveGitRuntimeTarget(input: GitExtensionTargetInput): GitExtensionTarget {
  if (typeof input === "string") {
    return resolveGitExtensionTarget(input)
  }
  return resolveGitExtensionTarget(input.url, {
    ref: input.ref,
    subdir: input.subdir,
  })
}

function copyGitExtensionDirectory(sourceDir: string, targetDir: string): void {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const basename = path.basename(sourcePath)
      return basename !== ".git" && basename !== "node_modules"
    },
  })
}

function buildGitExtensionSummary(
  target: GitExtensionTarget,
  manifest: ExtensionManifestLike,
  distribution: DistributionAnalysis,
  commit: string | undefined,
  rootDir?: string,
  scope: InstallScope = { kind: "global" },
): ExtensionSummary {
  const installed = loadInstalledExtensions(
    scope.kind === "agent" ? { agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName } : undefined,
  ).find((item) => item.name === manifest.name)
  const stateLabel = installed
    ? `将覆盖已安装版本 ${installed.version}`
    : "Git 待安装"
  const installLocation = scope.kind === "agent"
    ? `~/.iris/agents/${scope.agentName}/extensions/${manifest.name}/`
    : `~/.iris/extensions/${manifest.name}/`
  const statusDetail = installed
    ? `本地已安装 ${installed.version}。确认安装后会覆盖 ${installLocation}。`
    : `当前 Git 仓库中的 extension 尚未安装到用户目录（目标：${installLocation}）。`

  return buildSummary(formatGitExtensionTarget(target), manifest, {
    rootDir,
    installed: false,
    enabled: false,
    stateLabel,
    statusDetail,
    installSource: "git",
    gitUrl: target.url,
    gitRef: target.ref,
    gitCommit: commit,
    gitSubdir: target.subdir,
    distributionMode: distribution.distributionMode,
    distributionLabel: distribution.distributionLabel,
    distributionDetail: distribution.distributionDetail,
    runnableEntries: distribution.runnableEntries,
  })
}

export async function inspectGitExtension(
  input: GitExtensionTargetInput,
  options: GitExtensionRuntimeOptions = {},
  scope: InstallScope = { kind: "global" },
): Promise<GitExtensionPreview> {
  const target = resolveGitRuntimeTarget(input)
  const installedRootDir = resolveInstallDirForScope(scope)
  ensureDirectory(installedRootDir)
  const tempRootDir = createTempInstallDir(installedRootDir)
  const cloneDir = path.join(tempRootDir, "repo")

  try {
    const cloned = await cloneGitRepository(target, cloneDir, { commandRunner: options.commandRunner })
    const sourceDir = target.subdir ? resolveSafeRelativePath(cloneDir, target.subdir) : cloneDir
    const manifest = readManifestFromDir(sourceDir)
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`)
    }
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(sourceDir), manifest)
    return {
      summary: buildGitExtensionSummary(target, manifest, distribution, cloned.commit, undefined, scope),
      target,
      commit: cloned.commit,
    }
  } finally {
    cleanupTempInstallDir(tempRootDir)
  }
}

interface InstallGitTargetContext {
  expectedName?: string
  existingMetadata?: GitInstallMetadata
}

function buildInstalledGitSummary(
  target: GitExtensionTarget,
  manifest: ExtensionManifestLike,
  distribution: DistributionAnalysis,
  commit: string | undefined,
  targetDir: string,
  scope: InstallScope = { kind: "global" },
): ExtensionSummary {
  const state = resolveInstalledState(manifest, targetDir)
  const sourceLabel = scope.kind === "agent" ? "Agent 安装" : "已安装"
  return buildSummary(formatGitExtensionTarget(target), manifest, {
    rootDir: targetDir,
    installed: true,
    enabled: state.enabled,
    stateLabel: state.stateLabel,
    statusDetail: state.statusDetail,
    localSource: scope.kind === "agent" ? "agent-installed" : "installed",
    localSourceLabel: sourceLabel,
    installSource: "git",
    gitUrl: target.url,
    gitRef: target.ref,
    gitCommit: commit,
    gitSubdir: target.subdir,
    localVersion: manifest.version!,
    localVersionHint: `本地已有版本 ${manifest.version!}（已安装，运行时优先于源码内嵌）`,
    distributionMode: distribution.distributionMode,
    distributionLabel: distribution.distributionLabel,
    distributionDetail: distribution.distributionDetail,
    runnableEntries: distribution.runnableEntries,
    agentName: scope.kind === "agent" ? scope.agentName : undefined,
  })
}

async function installGitTarget(
  target: GitExtensionTarget,
  options: GitExtensionRuntimeOptions = {},
  context: InstallGitTargetContext = {},
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  const installedRootDir = resolveInstallDirForScope(scope)
  ensureDirectory(installedRootDir)
  const tempRootDir = createTempInstallDir(installedRootDir)
  const cloneDir = path.join(tempRootDir, "repo")
  const packageDir = path.join(tempRootDir, "package")

  try {
    const cloned = await cloneGitRepository(target, cloneDir, { commandRunner: options.commandRunner })
    const sourceDir = target.subdir ? resolveSafeRelativePath(cloneDir, target.subdir) : cloneDir
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      throw new Error(`Git 仓库中未找到 extension 目录: ${target.subdir ?? "."}`)
    }

    copyGitExtensionDirectory(sourceDir, packageDir)
    const manifest = readManifestFromDir(packageDir)
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`)
    }
    if (context.expectedName && manifest.name !== context.expectedName) {
      throw new Error(`Git extension manifest.name 不匹配：期望 ${context.expectedName}，实际 ${manifest.name}`)
    }

    const distribution = analyzeDistribution(collectRelativeFilesFromDir(packageDir), manifest)
    if (distribution.distributionMode !== "bundled") {
      throw new Error(distribution.distributionDetail)
    }
    writeGitInstallMetadata(packageDir, target, cloned.commit, {
      installedAt: context.existingMetadata?.installedAt,
      updatedAt: context.existingMetadata ? new Date().toISOString() : undefined,
    })

    const targetDir = path.join(installedRootDir, manifest.name!)
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.renameSync(packageDir, targetDir)

    if (hasPluginContribution(manifest)) {
      upsertLocalPluginEnabled(manifest.name!, false, scope)
    }

    return buildInstalledGitSummary(target, manifest, distribution, cloned.commit, targetDir, scope)
  } finally {
    cleanupTempInstallDir(tempRootDir)
  }
}

export async function installGitExtension(
  input: GitExtensionTargetInput,
  options: GitExtensionRuntimeOptions = {},
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  return installGitTarget(resolveGitRuntimeTarget(input), options, {}, scope)
}

function resolveInstalledGitTarget(summary: ExtensionSummary): GitExtensionTarget {
  if (!summary.rootDir) {
    throw new Error(`extension ${summary.name} 缺少本地安装目录，无法升级`)
  }
  const metadata = readGitInstallMetadata(summary.rootDir)
  const url = metadata?.url ?? summary.gitUrl
  if (!url) {
    throw new Error(`extension ${summary.name} 不是通过 Git 安装的，无法按 Git 来源升级`)
  }
  return resolveGitExtensionTarget(url, {
    ref: metadata?.ref ?? summary.gitRef,
    subdir: metadata?.subdir ?? summary.gitSubdir,
  })
}

export async function inspectGitExtensionUpdate(
  summary: ExtensionSummary,
  options: GitExtensionRuntimeOptions = {},
): Promise<GitExtensionUpdatePreview> {
  const target = resolveInstalledGitTarget(summary)
  const scope = scopeFromSummary(summary)
  const installedRootDir = resolveInstallDirForScope(scope)
  ensureDirectory(installedRootDir)
  const tempRootDir = createTempInstallDir(installedRootDir)
  const cloneDir = path.join(tempRootDir, "repo")

  try {
    const cloned = await cloneGitRepository(target, cloneDir, { commandRunner: options.commandRunner })
    const sourceDir = target.subdir ? resolveSafeRelativePath(cloneDir, target.subdir) : cloneDir
    const manifest = readManifestFromDir(sourceDir)
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`)
    }
    if (manifest.name !== summary.name) {
      throw new Error(`Git extension manifest.name 不匹配：期望 ${summary.name}，实际 ${manifest.name}`)
    }
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(sourceDir), manifest)
    const sameCommit = !!summary.gitCommit && summary.gitCommit === cloned.commit
    const previewSummary = buildSummary(formatGitExtensionTarget(target), manifest, {
      installed: true,
      enabled: summary.enabled,
      stateLabel: sameCommit ? "当前已是记录的 Git commit" : `准备升级到 ${manifest.version}`,
      statusDetail: `当前 commit: ${summary.gitCommit ?? "未知"}；远程 commit: ${cloned.commit ?? "未知"}。`,
      installSource: "git",
      gitUrl: target.url,
      gitRef: target.ref,
      gitCommit: cloned.commit,
      gitSubdir: target.subdir,
      localVersion: summary.version,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    })
    return {
      summary: previewSummary,
      target,
      commit: cloned.commit,
      current: summary,
      previousCommit: summary.gitCommit,
      sameCommit,
    }
  } finally {
    cleanupTempInstallDir(tempRootDir)
  }
}

export async function updateGitInstalledExtension(
  summary: ExtensionSummary,
  options: GitExtensionRuntimeOptions = {},
): Promise<ExtensionSummary> {
  const target = resolveInstalledGitTarget(summary)
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  const existingMetadata = readGitInstallMetadata(rootDir)
  const preserveDisabledMarker = fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE))
  const wasEnabled = summary.enabled

  const updated = await installGitTarget(target, options, {
    expectedName: summary.name,
    existingMetadata,
  }, scope)

  if (preserveDisabledMarker) {
    disableInstalledExtension(updated)
  } else if (wasEnabled) {
    enableInstalledExtension(updated)
  }

  // 同 scope 重新加载
  const reloaded = scope.kind === "agent"
    ? loadInstalledExtensions({ agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName })
    : loadInstalledExtensions()
  return reloaded.find((item) => item.name === summary.name) ?? updated
}

export function enableInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  setDisabledMarker(rootDir, false)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, true, scope)
  }
}

export function disableInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  setDisabledMarker(rootDir, true)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false, scope)
  }
}

export function deleteInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  fs.rmSync(rootDir, { recursive: true, force: true })
  if (summary.hasPlugin) {
    removeLocalPluginEntry(summary.name, scope)
  }
}
