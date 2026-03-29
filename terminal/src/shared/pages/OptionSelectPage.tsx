import { useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { gracefulExit } from "../runtime.js"
import { PageFrame } from "./PageFrame.js"
import { wrapTextByDisplayWidth } from "../text-utils.js"

export interface OptionSelectItem {
  value: string
  label: string
  description?: string
}

interface OptionSelectPageProps {
  title: string
  description?: string
  options: OptionSelectItem[]
  onSelect: (value: string) => void
  onSkip?: () => void
  onBack?: () => void
  maxVisibleOptions?: number
  initialSelectedIndex?: number
}

export function OptionSelectPage({
  title,
  description,
  options,
  onSelect,
  onSkip,
  onBack,
  maxVisibleOptions = 7,
  initialSelectedIndex = 0,
}: OptionSelectPageProps) {
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex)
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()

  // PageFrame 左右 padding 各 1 列，内容区宽度 = terminalWidth - 2
  const contentWidth = Math.max(8, terminalWidth - 2)

  // 标签折行宽度：PF左pad(1) + box左pad(1) + 前缀"❯ "(2) + PF右pad(1) = 5
  const labelWrapWidth = Math.max(8, terminalWidth - 5)
  // 描述折行宽度：PF左pad(1) + box左pad(1) + 前缀"    "(4) + PF右pad(1) = 7
  const descriptionWrapWidth = Math.max(8, terminalWidth - 7)

  // ---- 精确计算 PageFrame 框架占用的行数 ----

  // 描述文字折行后的实际行数
  const descriptionLineCount = description
    ? wrapTextByDisplayWidth(description, contentWidth).length
    : 0

  // 操作栏折行后的实际行数
  const actionsItems = [
    "↑↓ 选择",
    "Enter 确认",
    onSkip ? "Ctrl+N 跳过此环节" : undefined,
    onBack ? "Esc 返回" : undefined,
  ].filter((a): a is string => typeof a === "string" && a.trim().length > 0)
  const actionsLineCount = actionsItems.length > 0
    ? wrapTextByDisplayWidth(actionsItems.join("  |  "), contentWidth).length
    : 0

  // PageFrame 子元素数（标题 + [描述] + 内容区 + [操作栏]），gap=1 则间距 = 子元素数 - 1
  let pageChildCount = 2 // 标题 + 内容区始终存在
  if (descriptionLineCount > 0) pageChildCount++
  if (actionsLineCount > 0) pageChildCount++
  const gapLines = pageChildCount - 1

  // 总开销：padding(2) + 标题(1) + 描述行数 + 间距 + 操作栏行数
  const chromeHeight = 2 + 1 + descriptionLineCount + gapLines + actionsLineCount

  // 滚动指示器最多 2 行（“↑ 上方还有…” 和 “↓ 下方还有…”）
  const scrollIndicatorLines = 2

  // 可用于选项条目的行数
  const availableForOptions = terminalHeight - chromeHeight - scrollIndicatorLines

  // 预计算所有选项的最大行高（标签折行 + 描述折行）
  let maxOptionHeight = 1
  for (const option of options) {
    const ll = wrapTextByDisplayWidth(option.label, labelWrapWidth).length
    const dl = option.description
      ? wrapTextByDisplayWidth(option.description, descriptionWrapWidth).length
      : 0
    const h = ll + dl
    if (h > maxOptionHeight) maxOptionHeight = h
  }

  const effectiveMaxVisible = Math.min(
    maxVisibleOptions,
    Math.max(1, Math.floor(availableForOptions / maxOptionHeight)),
  )

  // ---- 滚动与可见选项 ----

  let scrollStart = 0
  if (options.length > effectiveMaxVisible) {
    scrollStart = Math.max(0, Math.min(selectedIndex - Math.floor(effectiveMaxVisible / 2), options.length - effectiveMaxVisible))
  }
  const visibleOptions = options.slice(scrollStart, scrollStart + effectiveMaxVisible)

  useKeyboard((key) => {
    if (key.name === "n" && key.ctrl) {
      onSkip?.()
      return
    }

    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((index) => Math.max(0, index - 1))
      return
    }

    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((index) => Math.min(options.length - 1, index + 1))
      return
    }

    if (key.name === "return") {
      const selected = options[selectedIndex]
      if (selected) {
        onSelect(selected.value)
      }
      return
    }

    if (key.name === "escape") {
      onBack?.()
      return
    }

    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  return (
    <PageFrame
      title={title}
      description={description}
      actions={[
        "↑↓ 选择",
        "Enter 确认",
        onSkip ? "Ctrl+N 跳过此环节" : undefined,
        onBack ? "Esc 返回" : undefined,
      ]}
    >
      <box flexDirection="column" gap={0}>
        {scrollStart > 0 && (
          <text fg="#636e72">{`↑ 上方还有 ${scrollStart} 项`}</text>
        )}

        {visibleOptions.map((option, index) => {
          const realIndex = scrollStart + index
          const isSelected = realIndex === selectedIndex
          const labelLines = wrapTextByDisplayWidth(option.label, labelWrapWidth)
          const descriptionLines = option.description
            ? wrapTextByDisplayWidth(option.description, descriptionWrapWidth)
            : []

          return (
            <box key={option.value} flexDirection="column" paddingLeft={1} flexShrink={0}>
              {labelLines.map((line, lineIndex) => (
                <text key={`${option.value}-label-${lineIndex}`} fg={isSelected ? "#dfe6e9" : "#b2bec3"}>
                  {lineIndex === 0
                    ? `${isSelected ? "❯ " : "  "}${line}`
                    : `  ${line}`}
                </text>
              ))}
              {descriptionLines.map((line, lineIndex) => (
                <text key={`${option.value}-description-${lineIndex}`} fg="#636e72">
                  {`    ${line}`}
                </text>
              ))}
            </box>
          )
        })}

        {scrollStart + effectiveMaxVisible < options.length && (
          <text fg="#636e72">{`↓ 下方还有 ${options.length - scrollStart - effectiveMaxVisible} 项`}</text>
        )}
      </box>
    </PageFrame>
  )
}
