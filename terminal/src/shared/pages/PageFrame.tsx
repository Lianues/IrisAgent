import type { ReactNode } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { wrapTextByDisplayWidth } from "../text-utils.js"

interface PageFrameProps {
  title: string
  description?: ReactNode
  actions?: Array<string | undefined>
  children: ReactNode
}

export function PageFrame({ title, description, actions = [], children }: PageFrameProps) {
  const visibleActions = actions.filter((action): action is string => typeof action === "string" && action.trim().length > 0)
  const { width: terminalWidth } = useTerminalDimensions()
  const contentWidth = Math.max(8, terminalWidth - 2)

  return (
    <box flexDirection="column" gap={1} padding={1} height="100%">
      <box flexShrink={0}>
        <text fg="#6c5ce7">
          <b>{title}</b>
        </text>
      </box>

      {typeof description === "string"
        ? (
          <box flexDirection="column" flexShrink={0}>
            {wrapTextByDisplayWidth(description, contentWidth).map((line, index) => (
              <text key={`desc-${index}`} fg="#636e72">{line}</text>
            ))}
          </box>
        )
        : description
          ? <box flexShrink={0}>{description}</box>
          : null}

      <box flexGrow={1} flexShrink={1} overflow="hidden">
        {children}
      </box>

      {visibleActions.length > 0 && (
        <box flexDirection="column" flexShrink={0}>
          {wrapTextByDisplayWidth(visibleActions.join("  |  "), contentWidth).map((line, index) => (
            <text key={`action-${index}`} fg="#636e72">{line}</text>
          ))}
        </box>
      )}
    </box>
  )
}
