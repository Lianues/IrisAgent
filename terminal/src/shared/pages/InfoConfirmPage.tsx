import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { gracefulExit } from "../runtime.js"
import { PageFrame } from "./PageFrame.js"

export type InfoConfirmTone = "normal" | "muted" | "warning" | "success" | "error"

export interface InfoConfirmRow {
  label: string
  value?: string | number
  valueTone?: InfoConfirmTone
  valueBold?: boolean
  emptyText?: string
  emptyTone?: InfoConfirmTone
  suffix?: string
  suffixTone?: InfoConfirmTone
}

export interface InfoConfirmSection {
  title?: string
  rows: InfoConfirmRow[]
}

export interface InfoConfirmNotice {
  title?: string
  lines: string[]
  tone?: "warning" | "info" | "success"
}

export interface InfoConfirmSuccessAction {
  command: string
  description?: string
}

interface InfoConfirmPageProps {
  title: string
  description?: string
  sections: InfoConfirmSection[]
  notices?: InfoConfirmNotice[]
  onConfirm: () => void | Promise<void>
  onBack?: () => void
  confirmActionText?: string
  backActionText?: string
  successTitle: string
  successLines?: string[]
  successActionsTitle?: string
  successActions?: InfoConfirmSuccessAction[]
}

type ConfirmStatus = "idle" | "running" | "confirmed"

function resolveToneColor(tone: InfoConfirmTone = "normal"): string {
  switch (tone) {
    case "muted":
      return "#636e72"
    case "warning":
      return "#fdcb6e"
    case "success":
      return "#00b894"
    case "error":
      return "#ff7675"
    default:
      return "#dfe6e9"
  }
}

function resolveNoticeBorderColor(tone: InfoConfirmNotice["tone"] = "info"): string {
  switch (tone) {
    case "warning":
      return "#fdcb6e"
    case "success":
      return "#00b894"
    default:
      return "#636e72"
  }
}

function resolveNoticeTitleColor(tone: InfoConfirmNotice["tone"] = "info"): string {
  switch (tone) {
    case "warning":
      return "#fdcb6e"
    case "success":
      return "#00b894"
    default:
      return "#dfe6e9"
  }
}

function renderRowValue(row: InfoConfirmRow) {
  const rawValue = row.value == null ? "" : String(row.value)
  const hasValue = rawValue.trim().length > 0

  if (hasValue) {
    const valueNode = <span fg={resolveToneColor(row.valueTone)}>{rawValue}</span>
    return row.valueBold ? <b>{valueNode}</b> : valueNode
  }

  return (
    <span fg={resolveToneColor(row.emptyTone ?? "muted")}>
      {row.emptyText ?? "未填写"}
    </span>
  )
}

export function InfoConfirmPage({
  title,
  description,
  sections,
  notices = [],
  onConfirm,
  onBack,
  confirmActionText = "Enter / y 确认",
  backActionText = "Esc / n 返回",
  successTitle,
  successLines = [],
  successActionsTitle,
  successActions = [],
}: InfoConfirmPageProps) {
  const [status, setStatus] = useState<ConfirmStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      gracefulExit()
      return
    }

    if (status === "running") {
      return
    }

    if (status === "idle" && (key.name === "return" || key.name === "y")) {
      setErrorMessage(null)
      setStatus("running")
      Promise.resolve(onConfirm())
        .then(() => {
          setStatus("confirmed")
        })
        .catch((error) => {
          setStatus("idle")
          setErrorMessage(error instanceof Error ? error.message : String(error))
        })
      return
    }

    if (status === "idle" && (key.name === "escape" || key.name === "n")) {
      onBack?.()
    }
  })

  return (
    <PageFrame
      title={title}
      description={description}
      actions={status === "confirmed"
        ? []
        : status === "running"
          ? ["正在处理..."]
          : [confirmActionText, onBack ? backActionText : undefined]}
    >
      {status !== "confirmed" ? (
        <>
          <box flexDirection="column" borderStyle="rounded" borderColor="#636e72" padding={1} gap={1}>
            {sections.map((section, index) => (
              <box key={`${section.title || "section"}-${index}`} flexDirection="column" gap={0}>
                {section.title && (
                  <text fg="#a29bfe">
                    <b>{section.title}</b>
                  </text>
                )}
                {section.rows.map((row, rowIndex) => (
                  <text key={`${row.label}-${rowIndex}`}>
                    <span fg="#636e72">{`${row.label}: `}</span>
                    {renderRowValue(row)}
                    {row.suffix && (
                      <span fg={resolveToneColor(row.suffixTone ?? "muted")}>{` ${row.suffix}`}</span>
                    )}
                  </text>
                ))}
              </box>
            ))}
          </box>

          {notices.map((notice, index) => (
            <box
              key={`${notice.title || "notice"}-${index}`}
              flexDirection="column"
              borderStyle="rounded"
              borderColor={resolveNoticeBorderColor(notice.tone)}
              padding={1}
            >
              {notice.title && (
                <text fg={resolveNoticeTitleColor(notice.tone)}>
                  <b>{notice.title}</b>
                </text>
              )}
              {notice.lines.map((line, lineIndex) => (
                <text key={`${line}-${lineIndex}`} fg={lineIndex === notice.lines.length - 1 ? "#636e72" : "#dfe6e9"}>
                  {line}
                </text>
              ))}
            </box>
          ))}

          {errorMessage && (
            <box flexDirection="column" borderStyle="rounded" borderColor="#ff7675" padding={1}>
              <text fg="#ff7675">
                <b>操作失败</b>
              </text>
              <text fg="#dfe6e9">{errorMessage}</text>
              <text fg="#636e72">按 Enter 重试，或按 Esc 返回。</text>
            </box>
          )}
        </>
      ) : (
        <box flexDirection="column" gap={1}>
          <text fg="#00b894">
            <b>{successTitle}</b>
          </text>

          {successLines.map((line, index) => (
            <text key={`${line}-${index}`} fg="#dfe6e9">{line}</text>
          ))}

          {successActions.length > 0 && (
            <box flexDirection="column" paddingLeft={2}>
              {successActionsTitle && <text fg="#dfe6e9">{successActionsTitle}</text>}
              {successActions.map((action, index) => (
                <text key={`${action.command}-${index}`}>
                  <span fg="#00b894">{`  ${action.command}`}</span>
                  {action.description && <span fg="#636e72">{`  — ${action.description}`}</span>}
                </text>
              ))}
            </box>
          )}
        </box>
      )}
    </PageFrame>
  )
}
