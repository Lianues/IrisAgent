import {
  definePlugin,
  createPluginLogger,
  type ConfigContribution,
  type Disposable,
  type IrisAPI,
  type PluginContext,
  type FunctionResponsePart,
} from 'irises-extension-sdk';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';
import {
  DEFAULT_TERMINAL_USE_TOOLS_CONFIG,
  fromTerminalUseConfigContributionValues,
  fromTerminalUseToolsContributionValues,
  parseTerminalUseConfig,
  parseTerminalUseToolsConfig,
  toTerminalUseConfigContributionValues,
  toTerminalUseToolsContributionValues,
  type TerminalUseToolsConfig,
} from './config.js';
import { DEFAULT_TOOLS_CONFIG_TEMPLATE } from './config-template.js';
import { setExtensionDir, TerminalEnvironment } from './terminal-env.js';
import { createTerminalUseTools, TERMINAL_USE_FUNCTION_NAMES } from './tools.js';
import type { TerminalState, TerminalUseConfig } from './types.js';

const logger = createPluginLogger('terminal-use');

let activeConfig: TerminalUseConfig | undefined;
let activeToolsConfig: TerminalUseToolsConfig = { ...DEFAULT_TERMINAL_USE_TOOLS_CONFIG };
let activeEnv: TerminalEnvironment | undefined;
let cachedApi: IrisAPI | undefined;
let lastConfigSnapshot = '';
let toolsRegistered = false;
let reloading = false;
let pendingReload: { rawConfig: unknown; rawToolsConfig: unknown; api: IrisAPI; ctx: PluginContext } | null = null;
const contributionDisposables: Disposable[] = [];

export default definePlugin({
  name: 'terminal-use',
  version: '0.1.0',
  description: 'Persistent headless terminal session for LLM tool use',

  activate(ctx: PluginContext) {
    const extDir = ctx.getExtensionRootDir();
    setExtensionDir(extDir);

    const created = ctx.ensureConfigFile('terminal_use.yaml', DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger.info('已在配置目录中安装 terminal_use.yaml 默认模板');
    }
    const createdToolConfig = ctx.ensureConfigFile('terminal_use_tools.yaml', DEFAULT_TOOLS_CONFIG_TEMPLATE);
    if (createdToolConfig) {
      logger.info('已在配置目录中安装 terminal_use_tools.yaml 默认模板');
    }

    registerConfigContributions(ctx);

    ctx.onReady(async (api) => {
      cachedApi = api;
      const raw = resolveRawConfigs(ctx, api);
      await safeReload(raw.rawConfig, raw.rawToolsConfig, api, ctx);
    });

    ctx.addHook({
      name: 'terminal-use:config-reload',
      async onConfigReload({ rawMergedConfig }) {
        if (!cachedApi) return;
        const merged = rawMergedConfig as Record<string, unknown>;
        const rawConfig = merged.terminal_use;
        const rawToolsConfig = merged.terminal_use_tools;
        await safeReload(rawConfig, rawToolsConfig, cachedApi, ctx);
      },
    });

    ctx.addHook({
      name: 'terminal-use:prune-old-snapshots',
      onBeforeLLMCall({ request }) {
        const max = activeConfig?.maxRecentSnapshots ?? 0;
        if (!activeConfig || max === Infinity) return undefined;

        let snapshotRounds = 0;
        for (let i = request.contents.length - 1; i >= 0; i--) {
          const content = request.contents[i];
          if (content.role !== 'user') continue;

          const hasTerminalSnapshot = content.parts.some(
            part => 'functionResponse' in part
              && TERMINAL_USE_FUNCTION_NAMES.has((part as FunctionResponsePart).functionResponse.name),
          );
          if (!hasTerminalSnapshot) continue;

          snapshotRounds += 1;
          if (snapshotRounds <= max) continue;

          for (const part of content.parts) {
            if (!('functionResponse' in part)) continue;
            const functionResponse = (part as FunctionResponsePart).functionResponse;
            if (!TERMINAL_USE_FUNCTION_NAMES.has(functionResponse.name)) continue;
            const response = functionResponse.response as Record<string, unknown> | undefined;
            const result = response?.result as Record<string, unknown> | undefined;
            if (!result || typeof result !== 'object') continue;
            delete result.screen;
            delete result.display;
            delete result.output;
            delete result.commandOutput;
            result.snapshotPruned = true;
          }
        }

        return { request };
      },
    });
  },

  async deactivate() {
    for (const disposable of contributionDisposables.splice(0, contributionDisposables.length)) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    if (cachedApi) unregisterTools(cachedApi);
    await destroyEnvironment();
    activeConfig = undefined;
    activeToolsConfig = { ...DEFAULT_TERMINAL_USE_TOOLS_CONFIG };
    cachedApi = undefined;
    lastConfigSnapshot = '';
    pendingReload = null;
    reloading = false;
  },
});

function resolveRawConfigs(ctx: PluginContext, api: IrisAPI): { rawConfig: unknown; rawToolsConfig: unknown } {
  const pluginConfig = ctx.getPluginConfig<Record<string, unknown>>();
  return {
    rawConfig: ctx.readConfigSection('terminal_use')
      ?? pluginConfig
      ?? (api.config as Record<string, unknown>).terminal_use
      ?? (api.config as Record<string, unknown>).terminalUse,
    rawToolsConfig: ctx.readConfigSection('terminal_use_tools')
      ?? (api.config as Record<string, unknown>).terminal_use_tools,
  };
}

async function getEnvironment(): Promise<TerminalEnvironment> {
  if (!activeConfig) {
    throw new Error('terminal-use 未启用。请先在 terminal_use.yaml 中设置 enabled: true，并在 plugins.yaml 中加载 terminal-use 插件。');
  }
  if (activeEnv) return activeEnv;

  const env = new TerminalEnvironment({
    shell: activeConfig.shell,
    cwd: activeConfig.cwd,
    cols: activeConfig.cols,
    rows: activeConfig.rows,
    scrollback: activeConfig.scrollback,
    startupTimeoutMs: activeConfig.startupTimeoutMs,
    idleQuietMs: activeConfig.idleQuietMs,
    maxDisplayChars: activeConfig.maxDisplayChars,
    maxCommandOutputChars: activeConfig.maxCommandOutputChars,
  });
  await env.initialize();
  activeEnv = env;
  return env;
}

async function destroyEnvironment(): Promise<void> {
  if (!activeEnv) return;
  try {
    await activeEnv.dispose();
  } catch {
    // ignore
  }
  activeEnv = undefined;
}

async function restartEnvironment(): Promise<TerminalState> {
  await destroyEnvironment();
  const env = await getEnvironment();
  return env.snapshot(true);
}

function unregisterTools(api: IrisAPI): void {
  const registry = api.tools as { unregister?: (name: string) => boolean };
  if (!registry.unregister) return;
  for (const name of TERMINAL_USE_FUNCTION_NAMES) {
    registry.unregister(name);
  }
  toolsRegistered = false;
}

function registerTools(api: IrisAPI): void {
  if (toolsRegistered) return;
  api.tools.registerAll(createTerminalUseTools({
    getEnv: getEnvironment,
    restartEnv: restartEnvironment,
    getConfig: () => activeConfig,
    getRouter: () => cachedApi?.router,
    getToolsConfig: () => activeToolsConfig,
  }));
  toolsRegistered = true;
}

async function safeReload(rawConfig: unknown, rawToolsConfig: unknown, api: IrisAPI, ctx: PluginContext): Promise<void> {
  if (reloading) {
    pendingReload = { rawConfig, rawToolsConfig, api, ctx };
    return;
  }
  reloading = true;
  try {
    await doReload(rawConfig, rawToolsConfig, api, ctx);
  } finally {
    reloading = false;
    if (pendingReload) {
      const next = pendingReload;
      pendingReload = null;
      await safeReload(next.rawConfig, next.rawToolsConfig, next.api, next.ctx);
    }
  }
}

async function doReload(rawConfig: unknown, rawToolsConfig: unknown, api: IrisAPI, ctx: PluginContext): Promise<void> {
  const snapshot = JSON.stringify({ rawConfig: rawConfig ?? null, rawToolsConfig: rawToolsConfig ?? null });
  if (snapshot === lastConfigSnapshot) return;
  lastConfigSnapshot = snapshot;

  const parsed = parseTerminalUseConfig(rawConfig, api.projectRoot ?? process.cwd());
  activeToolsConfig = parseTerminalUseToolsConfig(rawToolsConfig);
  activeConfig = parsed;

  await destroyEnvironment();

  if (!parsed?.enabled) {
    unregisterTools(api);
    logger.info('terminal-use 已禁用');
    return;
  }

  registerTools(api);
  logger.info(`terminal-use 已启用 [cwd=${parsed.cwd}, cols=${parsed.cols}, rows=${parsed.rows}]`);
}

function registerConfigContributions(ctx: PluginContext): void {
  const registry = ctx.getConfigContributions();
  const terminalUseContribution: ConfigContribution = {
    pluginName: 'terminal-use',
    sectionId: 'terminal_use',
    title: 'Terminal Use',
    description: 'terminal-use 扩展自己的终端会话配置。',
    fields: [
      { key: 'enabled', type: 'boolean', label: '启用 Terminal Use', default: false, group: '基础' },
      { key: 'cwd', type: 'string', label: '启动目录', default: '.', group: '基础' },
      { key: 'shell', type: 'string', label: 'Shell 路径', default: '', group: '基础', description: '可选。留空则自动选择当前平台默认 shell。' },
      { key: 'cols', type: 'number', label: '列数', default: 120, group: '终端' },
      { key: 'rows', type: 'number', label: '行数', default: 32, group: '终端' },
      { key: 'scrollback', type: 'number', label: 'Scrollback 行数', default: 5000, group: '终端' },
      { key: 'startupTimeoutMs', type: 'number', label: '启动超时(ms)', default: 10000, group: '超时' },
      { key: 'defaultCommandTimeoutMs', type: 'number', label: '默认命令超时(ms)', default: 30000, group: '超时' },
      { key: 'defaultWaitTimeoutMs', type: 'number', label: '默认等待超时(ms)', default: 10000, group: '超时' },
      { key: 'idleQuietMs', type: 'number', label: '空闲静默窗口(ms)', default: 350, group: '超时' },
      { key: 'maxDisplayChars', type: 'number', label: '最大屏幕字符数', default: 12000, group: '输出' },
      { key: 'maxCommandOutputChars', type: 'number', label: '最大命令输出字符数', default: 50000, group: '输出' },
      { key: 'maxRecentSnapshots', type: 'number', label: '保留最近快照轮数', default: 3, group: '输出' },
    ],
    onLoad: () => toTerminalUseConfigContributionValues(parseTerminalUseConfig(ctx.readConfigSection('terminal_use'), cachedApi?.projectRoot ?? process.cwd()), cachedApi?.projectRoot ?? process.cwd()),
    onSave: async (values) => {
      if (!cachedApi?.configManager) throw new Error('configManager 不可用，无法保存 terminal_use 配置');
      const raw = fromTerminalUseConfigContributionValues(values);
      const { mergedRaw } = cachedApi.configManager.updateEditableConfig({ terminal_use: raw });
      await cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    },
  };

  const terminalUseToolsContribution: ConfigContribution = {
    pluginName: 'terminal-use',
    sectionId: 'terminal_use_tools',
    title: 'Terminal Use Tools',
    description: 'terminal-use 工具自身的审批与安全分类配置。',
    fields: [
      { key: 'getTerminalSnapshotAutoApprove', type: 'boolean', label: '自动批准 get_terminal_snapshot', default: true, group: '审批' },
      { key: 'restartTerminalAutoApprove', type: 'boolean', label: '自动批准 restart_terminal', default: false, group: '审批' },
      { key: 'typeTerminalTextAutoApprove', type: 'boolean', label: '自动批准 type_terminal_text', default: false, group: '审批' },
      { key: 'pressTerminalKeyAutoApprove', type: 'boolean', label: '自动批准 press_terminal_key', default: false, group: '审批' },
      { key: 'scrollTerminalAutoApprove', type: 'boolean', label: '自动批准 scroll_terminal', default: true, group: '审批' },
      { key: 'waitTerminalAutoApprove', type: 'boolean', label: '自动批准 wait_terminal', default: true, group: '审批' },
      { key: 'interruptTerminalAutoApprove', type: 'boolean', label: '自动批准 interrupt_terminal', default: false, group: '审批' },
      { key: 'execClassifierEnabled', type: 'boolean', label: '启用 exec_terminal_command 分类器', default: true, group: '命令安全' },
      { key: 'execClassifierModel', type: 'string', label: '分类器模型', default: '', group: '命令安全' },
      { key: 'execConfidenceThreshold', type: 'number', label: '分类器置信度阈值', default: 0.8, group: '命令安全', validation: { min: 0, max: 1 } },
      { key: 'execFallbackPolicy', type: 'select', label: '分类器兜底策略', default: 'deny', group: '命令安全', options: [{ label: '拒绝', value: 'deny' }, { label: '放行', value: 'allow' }] },
      { key: 'execClassifierTimeout', type: 'number', label: '分类器超时(ms)', default: 8000, group: '命令安全' },
    ],
    onLoad: () => toTerminalUseToolsContributionValues(parseTerminalUseToolsConfig(ctx.readConfigSection('terminal_use_tools'))),
    onSave: async (values) => {
      if (!cachedApi?.configManager) throw new Error('configManager 不可用，无法保存 terminal_use_tools 配置');
      const raw = fromTerminalUseToolsContributionValues(values);
      const { mergedRaw } = cachedApi.configManager.updateEditableConfig({ terminal_use_tools: raw as Record<string, unknown> });
      await cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    },
  };

  contributionDisposables.push(registry.register(terminalUseContribution));
  contributionDisposables.push(registry.register(terminalUseToolsContribution));
}
