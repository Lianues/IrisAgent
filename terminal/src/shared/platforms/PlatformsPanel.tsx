import { useMemo, useState } from "react"
import {
  OptionSelectPage,
  ScrollableInputPage,
  type OptionSelectItem,
  type ScrollableInputFieldDefinition,
} from "../pages/index.js"
import type {
  PlatformOption,
  PlatformPanelFieldDefinition,
} from "./catalog.js"

export interface PlatformsPanelProps {
  availablePlatforms: PlatformOption[]
  title?: string
  description?: string
  configTitle?: string
  onSelect: (platform: string, values: Record<string, string | number | boolean>) => void
  onSkip?: () => void
  onBack?: () => void
}

function buildPanelDescription(platform: PlatformOption): string {
  const panelDescription = platform.panelDescription?.trim()
  if (panelDescription) {
    return `${platform.label} · ${panelDescription}`
  }
  return `${platform.label} · ${platform.desc}`
}

function buildFieldDescription(field: PlatformPanelFieldDefinition): string | undefined {
  const parts: string[] = []
  if (field.description?.trim()) {
    parts.push(field.description.trim())
  }
  if (field.example?.trim()) {
    parts.push(`示例：${field.example.trim()}`)
  }
  return parts.length > 0 ? parts.join(" ") : undefined
}

function buildInputFields(platform: PlatformOption): ScrollableInputFieldDefinition[] {
  return platform.panelFields.map((field) => ({
    key: field.key,
    label: field.label,
    description: buildFieldDescription(field),
    placeholder: field.placeholder ?? field.example ?? (field.defaultValue != null ? String(field.defaultValue) : undefined),
    defaultValue: field.defaultValue != null ? String(field.defaultValue) : undefined,
    required: field.required,
    masked: field.type === "password",
    normalizePastedText: field.type === "number"
      ? (text) => text.replace(/[^0-9.-]/g, "")
      : undefined,
    validate: field.type === "number"
      ? (value) => {
          if (value.trim().length === 0) {
            return field.required ? `请填写 ${field.label}` : undefined
          }
          return Number.isFinite(Number(value.trim())) ? undefined : `${field.label} 必须是数字`
        }
      : undefined,
  }))
}

function normalizePanelValues(
  platform: PlatformOption,
  values: Record<string, string>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}

  for (const field of platform.panelFields) {
    const rawValue = (values[field.key] ?? "").trim()
    if (rawValue.length === 0) continue

    const configKey = field.configKey || field.key
    if (field.type === "number") {
      result[configKey] = Number(rawValue)
    } else {
      result[configKey] = rawValue
    }
  }

  return result
}

export function PlatformsPanel({
  availablePlatforms,
  title = "平台配置",
  description = "选择要启用的平台。console / web / headless 为内置选项，其他平台来自当前可用 extension。",
  configTitle = "平台参数配置",
  onSelect,
  onSkip,
  onBack,
}: PlatformsPanelProps) {
  const [selectedPlatformName, setSelectedPlatformName] = useState("console")
  const [configPlatformName, setConfigPlatformName] = useState<string | null>(null)

  const platformOptions = useMemo(() => {
    return availablePlatforms.length > 0
      ? availablePlatforms
      : [{
          value: "console",
          label: "Console (TUI)",
          desc: "终端交互界面，适合本地开发和 SSH 使用。",
          source: "builtin" as const,
          panelFields: [],
        }]
  }, [availablePlatforms])

  const optionItems = useMemo<OptionSelectItem[]>(() => {
    return platformOptions.map((platform) => ({
      value: platform.value,
      label: platform.label,
      description: platform.desc,
    }))
  }, [platformOptions])

  const configPlatform = platformOptions.find((platform) => platform.value === configPlatformName) ?? null
  const initialSelectedIndex = Math.max(0, optionItems.findIndex((item) => item.value === selectedPlatformName))

  if (!configPlatform) {
    return (
      <OptionSelectPage
        title={title}
        description={description}
        options={optionItems}
        initialSelectedIndex={initialSelectedIndex}
        onSelect={(platformName) => {
          setSelectedPlatformName(platformName)
          const targetPlatform = platformOptions.find((platform) => platform.value === platformName)
          if (!targetPlatform || targetPlatform.panelFields.length === 0) {
            onSelect(platformName, {})
            return
          }
          setConfigPlatformName(platformName)
        }}
        onSkip={onSkip}
        onBack={onBack}
      />
    )
  }

  return (
    <ScrollableInputPage
      title={configPlatform.panelTitle || configTitle}
      description={buildPanelDescription(configPlatform)}
      fields={buildInputFields(configPlatform)}
      onSubmit={(values) => {
        setSelectedPlatformName(configPlatform.value)
        onSelect(configPlatform.value, normalizePanelValues(configPlatform, values))
      }}
      onSkip={onSkip}
      onBack={() => setConfigPlatformName(null)}
    />
  )
}
