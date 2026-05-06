/**
 * Agent 注册表（terminal 二进制本地版）
 *
 * 读取 ~/.iris/agents.yaml 列出可选 agent。terminal 不能 import 主进程的
 * src/agents/registry.ts，所以这里复制一份最小实现。
 */

import fs from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { resolveRuntimeDataDir } from "irises-extension-sdk/utils"

export interface AgentInfo {
  name: string
  description?: string
  /** 自定义 dataDir，未配置时使用 ~/.iris/agents/<name>/ */
  dataDir?: string
}

/** 读取 ~/.iris/agents.yaml 中定义的所有 agent；不存在或解析失败时返回空数组。 */
export function loadAgentList(): AgentInfo[] {
  const manifestPath = path.join(resolveRuntimeDataDir(), "agents.yaml")
  if (!fs.existsSync(manifestPath)) return []

  let raw: unknown
  try {
    raw = parse(fs.readFileSync(manifestPath, "utf-8"))
  } catch {
    return []
  }

  if (!raw || typeof raw !== "object") return []
  const agents = (raw as { agents?: unknown }).agents
  if (!agents || typeof agents !== "object") return []

  const result: AgentInfo[] = []
  for (const [name, def] of Object.entries(agents as Record<string, unknown>)) {
    if (!name) continue
    const d = (def && typeof def === "object" ? def : {}) as Record<string, unknown>
    result.push({
      name,
      description: typeof d.description === "string" ? d.description : undefined,
      dataDir: typeof d.dataDir === "string" ? d.dataDir : undefined,
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
