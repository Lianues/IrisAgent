import fs from "node:fs"
import path from "node:path"
import { resolveRuntimeDataDir } from "../runtime-paths.js"
import { normalizeText as normalizeTextShared } from "@iris/extension-utils"

export type PlatformPanelFieldType = "string" | "password" | "number"

export interface PlatformPanelFieldDefinition {
  key: string
  configKey: string
  type: PlatformPanelFieldType
  label: string
  description?: string
  placeholder?: string
  example?: string
  defaultValue?: string | number
  required?: boolean
}

export interface PlatformOption {
  value: string
  label: string
  desc: string
  source: "builtin" | "extension"
  panelTitle?: string
  panelDescription?: string
  panelFields: PlatformPanelFieldDefinition[]
}

interface ExtensionPlatformPanelFieldLike {
  key?: string
  configKey?: string
  type?: string
  label?: string
  description?: string
  placeholder?: string
  example?: string
  defaultValue?: string | number
  required?: boolean
}

interface ExtensionPlatformPanelLike {
  title?: string
  description?: string
  fields?: ExtensionPlatformPanelFieldLike[]
}

interface ExtensionPlatformContributionLike {
  name?: string
  label?: string
  description?: string
  panel?: ExtensionPlatformPanelLike
}

interface ExtensionManifestLike {
  name?: string
  description?: string
  platforms?: ExtensionPlatformContributionLike[]
}

const BUILTIN_PLATFORMS: PlatformOption[] = [
  {
    value: "console",
    label: "Console (TUI)",
    desc: "终端交互界面，适合本地开发和 SSH 使用。",
    source: "builtin",
    panelFields: [],
  },
  {
    value: "web",
    label: "Web (HTTP + GUI)",
    desc: "浏览器访问，适合服务器部署和远程使用。",
    source: "builtin",
    panelTitle: "平台配置",
    panelDescription: "填写 Web 平台的监听参数。",
    panelFields: [
      {
        key: "port",
        configKey: "port",
        type: "number",
        label: "Web 服务端口",
        description: "Web 服务监听端口。",
        placeholder: "8192",
        example: "8192",
        defaultValue: 8192,
        required: true,
      },
    ],
  },
]

function normalizeText(value: unknown): string | undefined { return normalizeTextShared(value) }

function normalizeFieldType(value: unknown): PlatformPanelFieldType {
  if (value === "password" || value === "number") {
    return value
  }
  return "string"
}

function normalizeDefaultValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  return undefined
}

function normalizePanelField(field: ExtensionPlatformPanelFieldLike): PlatformPanelFieldDefinition | undefined {
  const key = normalizeText(field.key)
  if (!key) return undefined

  return {
    key,
    configKey: normalizeText(field.configKey) ?? key,
    type: normalizeFieldType(field.type),
    label: normalizeText(field.label) ?? key,
    description: normalizeText(field.description),
    placeholder: normalizeText(field.placeholder),
    example: normalizeText(field.example),
    defaultValue: normalizeDefaultValue(field.defaultValue),
    required: field.required === true,
  }
}

function readExtensionManifest(extensionDir: string): ExtensionManifestLike | undefined {
  const manifestPath = path.join(extensionDir, "manifest.json")
  if (!fs.existsSync(manifestPath)) return undefined

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ExtensionManifestLike
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

function listExtensionRoots(installDir: string): string[] {
  const roots = [
    path.join(resolveRuntimeDataDir(), "extensions"),
    path.join(installDir, "extensions"),
  ]

  const deduped = new Set<string>()
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    if (!fs.statSync(root).isDirectory()) continue
    deduped.add(path.resolve(root))
  }

  return Array.from(deduped.values())
}

function collectExtensionPlatformsFromRoot(rootDir: string): PlatformOption[] {
  const results: PlatformOption[] = []

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const extensionDir = path.join(rootDir, entry.name)
    const manifest = readExtensionManifest(extensionDir)
    if (!manifest) continue

    for (const platformContribution of manifest.platforms ?? []) {
      const platformName = normalizeText(platformContribution.name)
      if (!platformName) continue

      const panelFields = Array.isArray(platformContribution.panel?.fields)
        ? platformContribution.panel.fields
            .map(normalizePanelField)
            .filter((field): field is PlatformPanelFieldDefinition => !!field)
        : []

      results.push({
        value: platformName,
        label: normalizeText(platformContribution.label) ?? platformName,
        desc: normalizeText(platformContribution.description)
          ?? normalizeText(manifest.description)
          ?? `${platformName} extension`,
        source: "extension",
        panelTitle: normalizeText(platformContribution.panel?.title),
        panelDescription: normalizeText(platformContribution.panel?.description),
        panelFields,
      })
    }
  }

  return results
}

export function loadAvailablePlatforms(installDir: string): PlatformOption[] {
  const platformMap = new Map<string, PlatformOption>()

  for (const builtin of BUILTIN_PLATFORMS) {
    platformMap.set(builtin.value, builtin)
  }

  for (const rootDir of listExtensionRoots(installDir)) {
    for (const platform of collectExtensionPlatformsFromRoot(rootDir)) {
      if (!platformMap.has(platform.value)) {
        platformMap.set(platform.value, platform)
      }
    }
  }

  const builtinPlatforms = BUILTIN_PLATFORMS
    .map((platform) => platformMap.get(platform.value))
    .filter((platform): platform is PlatformOption => !!platform)

  const extensionPlatforms = Array.from(platformMap.values())
    .filter((platform) => platform.source === "extension")
    .sort((a, b) => a.value.localeCompare(b.value))

  return [...builtinPlatforms, ...extensionPlatforms]
}

export function resolvePlatformOption(installDir: string, platformName: string): PlatformOption | undefined {
  return loadAvailablePlatforms(installDir).find((platform) => platform.value === platformName)
}

export function resolvePlatformLabel(installDir: string, platformName: string): string {
  return resolvePlatformOption(installDir, platformName)?.label ?? platformName
}
