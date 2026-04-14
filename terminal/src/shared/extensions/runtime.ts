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
} from "irises-extension-sdk/utils"

// ==================== TUI 专属类型 ====================

interface EditablePluginEntry {
  name: string
  type?: "local" | "npm"
  enabled?: boolean
  priority?: number
  config?: Record<string, unknown>
}

type ExtensionLocalSource = "installed" | "embedded"

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
  localSourceLabel?: string
  localVersion?: string
  localVersionHint?: string
}

export { getRemoteExtensionRequestTimeoutMs } from "irises-extension-sdk/utils"

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

function readEditablePluginEntries(): EditablePluginEntry[] {
  const pluginsPath = path.join(resolveRuntimeConfigDir(), "plugins.yaml")
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

function writeEditablePluginEntries(entries: EditablePluginEntry[]): void {
  const configDir = resolveRuntimeConfigDir()
  const pluginsPath = path.join(configDir, "plugins.yaml")
  ensureDirectory(configDir)
  const content = `# 插件配置\n\n${stringify({ plugins: entries }, { indent: 2 })}`
  fs.writeFileSync(pluginsPath, content, "utf-8")
}

function upsertLocalPluginEnabled(name: string, enabled: boolean): void {
  const entries = readEditablePluginEntries()
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

  writeEditablePluginEntries(entries)
}

function removeLocalPluginEntry(name: string): void {
  const nextEntries = readEditablePluginEntries().filter((entry) => !(entry.name === name && (entry.type ?? "local") === "local"))
  writeEditablePluginEntries(nextEntries)
}

function getPluginEnabledState(name: string): boolean | undefined {
  const entry = readEditablePluginEntries().find((item) => item.name === name && (item.type ?? "local") === "local")
  if (!entry) return undefined
  return entry.enabled !== false
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
        stateLabel: "已关闭",
        statusDetail: "该 extension 只包含插件入口，已在 plugins.yaml 中显式关闭。",
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
    localSourceLabel: options?.localSourceLabel,
    localVersion: options?.localVersion,
    localVersionHint: options?.localVersionHint,
  }
}

// ==================== 公开 API ====================

export function loadInstalledExtensions(): ExtensionSummary[] {
  const installedRootDir = getInstalledExtensionsDir()
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

    const state = resolveInstalledState(manifest, rootDir)
    results.push(buildSummary(manifest.name!, manifest, {
      rootDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: "installed",
      localSourceLabel: "已安装",
      localVersion: manifest.version!,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    }))
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

function loadEmbeddedExtensions(installDir: string): ExtensionSummary[] {
  const embeddedRootDir = getEmbeddedExtensionsDir(installDir)
  const embeddedConfigPath = path.join(embeddedRootDir, "embedded.json")
  if (!fs.existsSync(embeddedConfigPath)) {
    return []
  }

  try {
    const raw = JSON.parse(fs.readFileSync(embeddedConfigPath, "utf-8")) as {
      extensions?: Array<{ name?: string }>
    }
    const names = Array.isArray(raw.extensions)
      ? raw.extensions
          .map((item) => normalizeText(item?.name))
          .filter((name): name is string => !!name)
      : []

    const results: ExtensionSummary[] = []
    for (const name of names) {
      const rootDir = path.join(embeddedRootDir, name)
      const manifest = readManifestFromDir(rootDir)
      if (!manifest) continue
      const distribution = analyzeDistribution(collectRelativeFilesFromDir(rootDir), manifest)

      results.push(buildSummary(manifest.name!, manifest, {
        rootDir,
        installed: false,
        // 自动发现机制：embedded 扩展默认启用，仅 plugins.yaml 显式 false 或 disabled marker 关闭
        enabled: getPluginEnabledState(manifest.name!) !== false && !hasDisabledMarker(rootDir),
        stateLabel: "源码内嵌",
        statusDetail: "当前安装目录已内嵌该 extension。若用户目录安装同名版本，运行时将优先加载用户目录版本。",
        localSource: "embedded",
        localSourceLabel: "源码内嵌",
        localVersion: manifest.version!,
        distributionMode: distribution.distributionMode,
        distributionLabel: distribution.distributionLabel,
        distributionDetail: distribution.distributionDetail,
        runnableEntries: distribution.runnableEntries,
      }))
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
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

export async function listRemoteExtensions(installDir: string): Promise<ExtensionSummary[]> {
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
  const installedMap = new Map(loadInstalledExtensions().map((item) => [item.name, item]))
  const embeddedMap = new Map(loadEmbeddedExtensions(installDir).map((item) => [item.name, item]))
  const results: ExtensionSummary[] = []
  const seenRequestedPaths = new Set<string>()

  for (const entry of remoteEntries) {
    const requestedPath = entry.requestedPath
    if (seenRequestedPaths.has(requestedPath)) continue

    try {
      const distribution = analyzeDistribution(entry.files, entry.manifest)
      const local = installedMap.get(entry.manifest.name!) ?? embeddedMap.get(entry.manifest.name!)

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

export async function installRemoteExtension(requestedPath: string): Promise<ExtensionSummary> {
  const requested = normalizeRequestedExtensionPath(requestedPath, "extension 路径")
  const installedRootDir = getInstalledExtensionsDir()
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

    const state = resolveInstalledState(installedManifest, targetDir)
    return buildSummary(requested, installedManifest, {
      rootDir: targetDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: "installed",
      localSourceLabel: "已安装",
      localVersion: installedManifest.version!,
      localVersionHint: `本地已有版本 ${installedManifest.version!}（已安装，运行时优先于源码内嵌）`,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    })
  } catch (error) {
    cleanupTempInstallDir(tempDir)
    throw error
  }
}

export function enableInstalledExtension(summary: ExtensionSummary): void {
  const rootDir = summary.rootDir || path.join(getInstalledExtensionsDir(), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  setDisabledMarker(rootDir, false)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, true)
  }
}

export function disableInstalledExtension(summary: ExtensionSummary): void {
  const rootDir = summary.rootDir || path.join(getInstalledExtensionsDir(), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  setDisabledMarker(rootDir, true)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false)
  }
}

export function deleteInstalledExtension(summary: ExtensionSummary): void {
  const rootDir = summary.rootDir || path.join(getInstalledExtensionsDir(), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  fs.rmSync(rootDir, { recursive: true, force: true })
  if (summary.hasPlugin) {
    removeLocalPluginEntry(summary.name)
  }
}
