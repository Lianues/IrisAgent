import { App } from "./App.js"
import { resolveTerminalInstallDir } from "../../shared/install-dir.js"
import type { TerminalCommandContext, TerminalCommandDefinition } from "../types.js"

const extensionCommand: TerminalCommandDefinition = {
  name: "extension",
  title: "Iris Extension",
  description: "插件安装与管理界面",
  render(context: TerminalCommandContext) {
    return <App installDir={resolveTerminalInstallDir(context.commandArgs, context.executablePath)} />
  },
}

export default extensionCommand
