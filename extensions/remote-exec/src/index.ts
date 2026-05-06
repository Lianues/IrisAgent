/**
 * remote-exec — 入口
 *
 * 生命周期：
 *   activate()  释放默认配置，注册 onReady / onConfigReload
 *   onReady     读取配置 + 服务器清单 → 建 transport → 注册 switch_environment 工具 →
 *               安装工具 wrapper（含对将来注册工具的 monkey-patch 兜底）
 *   onConfigReload  重读配置/服务器清单，重建 transport，重注册 switch_environment（描述里的服务器列表会变化）
 *   deactivate  关闭 SSH 连接，撤销 register patch
 */

import path from 'node:path';
import { promises as fs, existsSync, writeFileSync } from 'node:fs';
import {
  definePlugin,
  createPluginLogger,
  type IrisAPI,
  type PluginContext,
  type ToolDefinition,
} from 'irises-extension-sdk';
import {
  DEFAULT_REMOTE_EXEC_YAML,
  DEFAULT_REMOTE_EXEC_SERVERS,
} from './config-template.js';
import { parseRemoteExecConfig, type RemoteExecConfig } from './config.js';
import { parseServersFile, type ServerEntry } from './ssh-config.js';
import { SshTransport } from './transport.js';
import { EnvironmentManager } from './environment.js';
import { buildSwitchEnvironmentTool } from './tools.js';
import { installToolWrappers, type WrapInstaller } from './wrap.js';

const logger = createPluginLogger('remote-exec');
const SERVERS_FILENAME = 'remote_exec_servers';

// 模块级状态
let cfg: RemoteExecConfig = parseRemoteExecConfig({});
let servers: Map<string, ServerEntry> = new Map();
let transport: SshTransport | undefined;
let envMgr: EnvironmentManager | undefined;
let installer: WrapInstaller | undefined;
let cachedApi: IrisAPI | undefined;
let cachedCtx: PluginContext | undefined;
/** 当前已注册的 switch_environment 工具名（用于 unregister 后重注册） */
let switchToolRegistered = false;

export default definePlugin({
  name: 'remote-exec',
  version: '0.1.0',
  description: '把工具调用透明转发到远端服务器执行（按"环境"切换，AI 无感）',

  activate(ctx: PluginContext) {
    cachedCtx = ctx;

    if (ctx.ensureConfigFile('remote_exec.yaml', DEFAULT_REMOTE_EXEC_YAML)) {
      logger.info('已生成默认配置 remote_exec.yaml');
    }
    ensureServersFile(ctx);

    ctx.onReady(async (api) => {
      cachedApi = api;
      await reloadAll(ctx, api);
    });

    ctx.addHook({
      name: 'remote-exec:config-reload',
      async onConfigReload({ rawMergedConfig }) {
        if (!cachedApi || !cachedCtx) return;
        const raw = (rawMergedConfig as Record<string, unknown>)?.remote_exec;
        cfg = parseRemoteExecConfig(raw ?? {});
        servers = await readServersFile(cachedCtx);
        rebuildTransport();
        // 重注册 switch_environment（环境列表可能已变）
        reregisterSwitchTool(cachedApi);
        installer?.applyToExistingTools();
        logger.info(
          `remote-exec 配置已热重载 — enabled=${cfg.enabled} servers=[${[...servers.keys()].join(', ')}] active=${envMgr?.getActive() ?? 'n/a'}`,
        );
      },
    });
  },

  async deactivate() {
    installer?.dispose();
    installer = undefined;
    transport?.closeAll();
    transport = undefined;
    if (cachedApi && switchToolRegistered) {
      cachedApi.tools.unregister?.('switch_environment');
      switchToolRegistered = false;
    }
    envMgr = undefined;
    cachedApi = undefined;
    cachedCtx = undefined;
  },
});

// ───────────────────────────── helpers ─────────────────────────────

function ensureServersFile(ctx: PluginContext): void {
  const dir = ctx.getConfigDir();
  const file = path.join(dir, SERVERS_FILENAME);
  if (existsSync(file)) return;
  try {
    writeFileSync(file, DEFAULT_REMOTE_EXEC_SERVERS, 'utf8');
    logger.info(`已生成默认服务器清单文件: ${file}`);
  } catch (err) {
    logger.warn(`生成 ${SERVERS_FILENAME} 失败: ${(err as Error).message}`);
  }
}

async function readServersFile(ctx: PluginContext): Promise<Map<string, ServerEntry>> {
  const file = path.join(ctx.getConfigDir(), SERVERS_FILENAME);
  try {
    const text = await fs.readFile(file, 'utf8');
    return parseServersFile(text);
  } catch (err) {
    logger.warn(`读取 ${SERVERS_FILENAME} 失败: ${(err as Error).message}`);
    return new Map();
  }
}

async function reloadAll(ctx: PluginContext, api: IrisAPI): Promise<void> {
  const merged = api.configManager?.readEditableConfig?.() as Record<string, unknown> | undefined;
  const rawSection = merged?.remote_exec ?? ctx.readConfigSection('remote_exec');
  cfg = parseRemoteExecConfig(rawSection ?? {});
  servers = await readServersFile(ctx);

  rebuildTransport();

  envMgr = new EnvironmentManager(api, () => servers, () => cfg);

  // 注册 switch_environment 工具
  reregisterSwitchTool(api);

  // 安装统一 wrapper
  if (!installer) {
    installer = installToolWrappers({
      ctx,
      api,
      envMgr,
      getConfig: () => cfg,
      getTransport: () => {
        if (!transport) throw new Error('remote-exec: SSH transport 未就绪');
        return transport;
      },
      logger,
    });
  }
  installer.applyToExistingTools();

  logger.info(
    `remote-exec 就绪 — enabled=${cfg.enabled} servers=[${[...servers.keys()].join(', ')}] ` +
      `default=${cfg.defaultEnvironment} active=${envMgr.getActive()}`,
  );
}

function rebuildTransport(): void {
  if (transport) transport.closeAll();
  transport = new SshTransport(servers, cfg.ssh, logger);
}

function reregisterSwitchTool(api: IrisAPI): void {
  if (!envMgr) return;
  // 总是先尝试注销旧的（描述里的环境列表可能已变）
  if (switchToolRegistered) {
    api.tools.unregister?.('switch_environment');
    switchToolRegistered = false;
  }
  if (!cfg.enabled || !cfg.exposeSwitchTool) return;
  const tool: ToolDefinition = buildSwitchEnvironmentTool(envMgr);
  api.tools.register(tool);
  switchToolRegistered = true;
}


