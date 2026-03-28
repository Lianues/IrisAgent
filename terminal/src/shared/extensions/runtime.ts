import fs from "node:fs"
import path from "node:path"
import JSZip from "jszip"
import { parse, stringify } from "yaml"
import { resolveRuntimeConfigDir, resolveRuntimeDataDir } from "../runtime-paths.js"

const MANIFEST_FILE = "manifest.json"
const DISABLED_MARKER_FILE = ".disabled"
const DEFAULT_REMOTE_EXTENSION_ARCHIVE_URL = "https://codeload.github.com/lianues/Iris/zip/refs/heads/main"
const DEFAULT_REMOTE_EXTENSION_ARCHIVE_ROOT_DIR = "Iris-main"
const DEFAULT_REMOTE_EXTENSIONS_SUBDIR = "extensions"
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"])
const RUNTIME_FILE_EXTENSIONS = new Set([".mjs", ".js", ".cjs"])

interface ExtensionPluginContributionLike {
  entry?: string
  configFile?: string
}

interface ExtensionPlatformContributionLike {
  name?: string
  entry?: string
}

interface ExtensionManifestLike {
  name?: string
  version?: string
  description?: string
  entry?: string
  plugin?: ExtensionPluginContributionLike
  platforms?: ExtensionPlatformContributionLike[]
}

interface EditablePluginEntry {
  name: string
  type?: "local" | "npm"
  enabled?: boolean
  priority?: number
  config?: Record<string, unknown>
}

type ExtensionLocalSource = "installed" | "embedded"

interface RuntimeEntryGroup {
  label: string
  alternatives: string[]
}

interface RuntimeEntryGroupAnalysis {
  label: string
  alternatives: string[]
  existingAlternatives: string[]
  runnableAlternatives: string[]
  sourceAlternatives: string[]
  needsBuild: boolean
}

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

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeRelativeFilePath(input: string, label = "文件路径"): string {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (!normalized) {
    throw new Error(`${label}不能为空`)
  }

  const parts = normalized.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label}无效: ${input}`)
  }

  return parts.join("/")
}

function normalizeRequestedExtensionPath(requested: string, label: string): string {
  let normalized = normalizeRelativeFilePath(requested, label)
  if (normalized.startsWith("extensions/")) {
    normalized = normalizeRelativeFilePath(normalized.slice("extensions/".length), label)
  }
  return normalized
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
}

function getInstalledExtensionsDir(): string {
  return path.join(resolveRuntimeDataDir(), "extensions")
}

function getEmbeddedExtensionsDir(installDir: string): string {
  return path.join(path.resolve(installDir), "extensions")
}

function getRemoteExtensionArchiveUrl(): string {
  return process.env.IRIS_EXTENSION_REMOTE_ARCHIVE_URL?.trim() || DEFAULT_REMOTE_EXTENSION_ARCHIVE_URL
}

function getRemoteArchiveRootDir(): string {
  return normalizeRelativeFilePath(
    process.env.IRIS_EXTENSION_REMOTE_ARCHIVE_ROOT_DIR?.trim() || DEFAULT_REMOTE_EXTENSION_ARCHIVE_ROOT_DIR,
    "远程压缩包根目录",
  )
}

function getRemoteExtensionsSubdir(): string {
  return normalizeRelativeFilePath(
    process.env.IRIS_EXTENSION_REMOTE_SUBDIR?.trim() || DEFAULT_REMOTE_EXTENSIONS_SUBDIR,
    "远程 extension 根目录",
  )
}

function resolveSafeRelativePath(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(normalizedRoot, relativePath)
  const relative = path.relative(normalizedRoot, resolvedPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径越界: ${relativePath}`)
  }
  return resolvedPath
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

function createTempInstallDir(installedRootDir: string): string {
  ensureDirectory(installedRootDir)
  const tempDir = path.join(
    installedRootDir,
    `.tmp-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  fs.mkdirSync(tempDir, { recursive: true })
  return tempDir
}

function cleanupTempInstallDir(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function parseExtensionManifest(raw: unknown, sourceLabel: string): ExtensionManifestLike {
  if (!raw || typeof raw !== "object") {
    throw new Error(`extension manifest 格式无效，应为对象: ${sourceLabel}`)
  }

  const manifest = raw as ExtensionManifestLike
  if (!normalizeText(manifest.name)) {
    throw new Error(`extension manifest 缺少 name: ${sourceLabel}`)
  }
  if (!normalizeText(manifest.version)) {
    throw new Error(`extension manifest 缺少 version: ${sourceLabel}`)
  }

  return manifest
}

function readManifestFromDir(rootDir: string): ExtensionManifestLike | undefined {
  const manifestPath = path.join(rootDir, MANIFEST_FILE)
  if (!fs.existsSync(manifestPath)) return undefined

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    return parseExtensionManifest(raw, manifestPath)
  } catch {
    return undefined
  }
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

function collectRuntimeEntryGroups(manifest: ExtensionManifestLike): RuntimeEntryGroup[] {
  const groups: RuntimeEntryGroup[] = []
  const pluginEntry = normalizeText(manifest.plugin?.entry) ?? normalizeText(manifest.entry)
  const platformEntries = Array.isArray(manifest.platforms)
    ? manifest.platforms.filter((platform) => !!normalizeText(platform?.name) && !!normalizeText(platform?.entry))
    : []

  if (pluginEntry) {
    groups.push({ label: "plugin", alternatives: [pluginEntry] })
  } else if (platformEntries.length === 0) {
    groups.push({
      label: "plugin",
      alternatives: ["index.mjs", "index.js", "index.cjs", "index.ts"],
    })
  }

  for (const platform of platformEntries) {
    groups.push({
      label: `platform:${normalizeText(platform.name)!}`,
      alternatives: [normalizeText(platform.entry)!],
    })
  }

  return groups
}

function analyzeRuntimeEntries(availableFiles: string[], manifest: ExtensionManifestLike): RuntimeEntryGroupAnalysis[] {
  const normalizedFiles = new Set(availableFiles.map((file) => normalizeZipEntryName(file)))

  return collectRuntimeEntryGroups(manifest).map((group) => {
    const existingAlternatives = group.alternatives.filter((relativePath) => normalizedFiles.has(normalizeZipEntryName(relativePath)))
    const runnableAlternatives = existingAlternatives.filter((relativePath) => {
      return RUNTIME_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
    })
    const sourceAlternatives = existingAlternatives.filter((relativePath) => {
      const ext = path.extname(relativePath).toLowerCase()
      return SOURCE_FILE_EXTENSIONS.has(ext) || /(^|[\\/])src([\\/]|$)/.test(relativePath)
    })

    return {
      label: group.label,
      alternatives: group.alternatives,
      existingAlternatives,
      runnableAlternatives,
      sourceAlternatives,
      needsBuild: runnableAlternatives.length === 0 || sourceAlternatives.length > 0,
    }
  })
}

function describeRuntimeIssues(analyses: RuntimeEntryGroupAnalysis[]): string {
  return analyses
    .filter((item) => item.needsBuild)
    .map((item) => {
      if (item.sourceAlternatives.length > 0) {
        return `${item.label} 使用了源码入口: ${item.sourceAlternatives.join(", ")}`
      }
      if (item.existingAlternatives.length > 0) {
        return `${item.label} 缺少可运行入口，当前存在: ${item.existingAlternatives.join(", ")}`
      }
      return `${item.label} 缺少入口文件，期望其一: ${item.alternatives.join(", ")}`
    })
    .join("；")
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

function collectRelativeFilesFromDir(rootDir: string): string[] {
  const files: string[] = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"))
    }
  }

  return files
}

function stripArchivePrefix(entryName: string, rootPrefix: string): string | undefined {
  const normalizedEntry = normalizeZipEntryName(entryName)
  const normalizedRoot = normalizeZipEntryName(rootPrefix)

  if (normalizedEntry === normalizedRoot) return ""
  if (normalizedEntry.startsWith(`${normalizedRoot}/`)) {
    return normalizedEntry.slice(normalizedRoot.length + 1)
  }

  const marker = `/${normalizedRoot}/`
  const markerIndex = normalizedEntry.indexOf(marker)
  if (markerIndex >= 0) {
    return normalizedEntry.slice(markerIndex + marker.length)
  }

  return undefined
}

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
    if (hasPlatforms && (pluginEnabled === false || pluginEnabled == null)) {
      return {
        enabled: false,
        stateLabel: "平台已启用，插件未启用",
        statusDetail: "平台贡献仍可被注册，插件入口当前未在 plugins.yaml 中启用。",
      }
    }

    if (!hasPlatforms && (pluginEnabled === false || pluginEnabled == null)) {
      return {
        enabled: false,
        stateLabel: "未启用",
        statusDetail: "该 extension 只包含插件入口，当前未在 plugins.yaml 中启用。",
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

async function fetchArchiveZip(): Promise<JSZip> {
  const response = await fetch(getRemoteExtensionArchiveUrl())
  if (!response.ok) {
    throw new Error(`远程 extension 仓库读取失败 (${response.status} ${response.statusText})`)
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer())
  return await JSZip.loadAsync(archiveBuffer)
}

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
        enabled: hasPlatformContribution(manifest) || getPluginEnabledState(manifest.name!) === true,
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
  const zip = await fetchArchiveZip()
  const installedMap = new Map(loadInstalledExtensions().map((item) => [item.name, item]))
  const embeddedMap = new Map(loadEmbeddedExtensions(installDir).map((item) => [item.name, item]))
  const prefix = `${getRemoteArchiveRootDir()}/${getRemoteExtensionsSubdir()}`
  const results: ExtensionSummary[] = []
  const seenRequestedPaths = new Set<string>()

  for (const fileEntry of Object.values(zip.files)) {
    if (fileEntry.dir) continue

    const relativePath = stripArchivePrefix(fileEntry.name, prefix)
    if (!relativePath) continue
    if (path.posix.basename(relativePath) !== MANIFEST_FILE) continue

    const requestedPath = normalizeRelativeFilePath(path.posix.dirname(relativePath), "远程 extension 目录")
    if (seenRequestedPaths.has(requestedPath)) continue

    try {
      const requestedPrefix = `${prefix}/${requestedPath}`
      const requestedFiles = Object.values(zip.files)
        .filter((item) => !item.dir)
        .map((item) => stripArchivePrefix(item.name, requestedPrefix))
        .filter((item): item is string => !!item)
      const manifest = parseExtensionManifest(JSON.parse(await fileEntry.async("text")), fileEntry.name)
      const distribution = analyzeDistribution(requestedFiles, manifest)
      const local = installedMap.get(manifest.name!) ?? embeddedMap.get(manifest.name!)

      results.push(buildSummary(requestedPath, manifest, local ? {
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
    const zip = await fetchArchiveZip()
    const prefix = `${getRemoteArchiveRootDir()}/${getRemoteExtensionsSubdir()}/${requested}`
    let extractedCount = 0

    for (const fileEntry of Object.values(zip.files)) {
      if (fileEntry.dir) continue
      const relativePath = stripArchivePrefix(fileEntry.name, prefix)
      if (!relativePath) continue

      const normalizedRelativePath = normalizeRelativeFilePath(relativePath)
      const destination = resolveSafeRelativePath(tempDir, normalizedRelativePath)
      ensureDirectory(path.dirname(destination))
      fs.writeFileSync(destination, await fileEntry.async("nodebuffer"))
      extractedCount += 1
    }

    if (extractedCount === 0) {
      throw new Error(`远程 extension 目录不存在: ${requested}`)
    }

    const manifest = readManifestFromDir(tempDir)
    if (!manifest) {
      throw new Error(`远程 extension 目录缺少 manifest.json: ${requested}`)
    }

    const distribution = analyzeDistribution(collectRelativeFilesFromDir(tempDir), manifest)
    if (distribution.distributionMode !== "bundled") {
      throw new Error(distribution.distributionDetail)
    }

    const targetDir = path.join(installedRootDir, manifest.name!)
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.renameSync(tempDir, targetDir)

    const state = resolveInstalledState(manifest, targetDir)
    return buildSummary(requested, manifest, {
      rootDir: targetDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: "installed",
      localSourceLabel: "已安装",
      localVersion: manifest.version!,
      localVersionHint: `本地已有版本 ${manifest.version!}（已安装，运行时优先于源码内嵌）`,
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
