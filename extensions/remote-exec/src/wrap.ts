/**
 * wrap.ts —— 统一工具拦截器
 *
 * 不使用 SDK 的 ctx.wrapTool：当前 SDK ToolWrapper 拿不到 ToolExecutionContext，
 * 会导致 shell/bash 这类 approvalMode='handler' 工具丢失审批上下文。
 * 这里直接替换 ToolDefinition.handler，完整透传 context（signal/approval 等）。
 */

import type {
  IrisAPI,
  PluginContext,
  ToolDefinition,
  ToolExecutionContext,
  ToolHandler,
} from 'irises-extension-sdk';
import { LOCAL_ENV, type RemoteExecConfig } from './config.js';
import type { EnvironmentManager } from './environment.js';
import type { SshTransport } from './transport.js';
import { getTranslator, listSupportedTools } from './translators.js';

export interface WrapInstaller {
  applyToExistingTools(): void;
  dispose(): void;
}

interface InstallParams {
  ctx: PluginContext;
  api: IrisAPI;
  envMgr: EnvironmentManager;
  getConfig: () => RemoteExecConfig;
  getTransport: () => SshTransport;
  logger: { info: (m: string) => void; warn: (m: string) => void };
}

export function installToolWrappers(p: InstallParams): WrapInstaller {
  const { api, envMgr, getConfig, getTransport, logger } = p;
  const wrappedTools = new WeakSet<object>();
  const restoreList: Array<() => void> = [];

  const wrapToolObject = (toolName: string, tool: ToolDefinition | undefined) => {
    if (!tool || wrappedTools.has(tool as unknown as object)) return;
    const translator = getTranslator(toolName);
    if (!translator) return;

    const original = tool.handler;
    const wrapped: ToolHandler = async (args: Record<string, unknown>, context?: ToolExecutionContext) => {
      const cfg = getConfig();
      if (!cfg.enabled) return original(args, context);

      const activeName = envMgr.getActive();
      if (activeName === LOCAL_ENV) return original(args, context);

      const server = envMgr.getActiveServer();
      if (!server) {
        logger.warn(`active=${activeName} 但找不到对应服务器条目，降级本地执行`);
        return original(args, context);
      }

      const remoteCwd = server.workdir ?? cfg.remoteWorkdir;
      try {
        return await translator(args, {
          transport: getTransport(),
          serverAlias: activeName,
          remoteCwd,
          signal: context?.signal,
        });
      } catch (err) {
        const msg = (err as Error).message;
        logger.warn(`远程执行 ${toolName} 失败 (${activeName}): ${msg}`);
        throw new Error(`[remote-exec/${activeName}] ${toolName} 远端执行失败: ${msg}`);
      }
    };

    tool.handler = wrapped;
    wrappedTools.add(tool as unknown as object);
    restoreList.push(() => {
      if (tool.handler === wrapped) tool.handler = original;
    });
    logger.info(`已为工具安装 remote-exec wrapper: ${toolName}`);
  };

  const applyToExistingTools = () => {
    const supported = new Set(listSupportedTools());
    const names = api.tools.listTools?.() ?? [];
    for (const name of names) {
      if (!supported.has(name)) continue;
      wrapToolObject(name, api.tools.get?.(name));
    }
  };

  // ── monkey-patch register 兜底后续注册的工具 ──
  const registry = api.tools as Record<string, any>;
  const originalRegister = registry.register?.bind(registry);
  let registerPatched = false;
  if (typeof originalRegister === 'function') {
    registry.register = function (tool: ToolDefinition) {
      const ret = originalRegister(tool);
      const name = tool?.declaration?.name;
      if (name && getTranslator(name)) {
        queueMicrotask(() => wrapToolObject(name, api.tools.get?.(name) ?? tool));
      }
      return ret;
    };
    registerPatched = true;
  }

  return {
    applyToExistingTools,
    dispose() {
      if (registerPatched && typeof originalRegister === 'function') registry.register = originalRegister;
      for (const restore of restoreList.splice(0)) restore();
    },
  };
}
