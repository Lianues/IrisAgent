import {
  createPluginLogger,
  definePlugin,
  extractText,
  type Content,
  type Disposable,
  type LLMRequest,
  type PluginContext,
} from 'irises-extension-sdk';
import { parseVirtualLoverConfig, type VirtualLoverConfig } from './config.js';
import { defaultConfigTemplate } from './config-template.js';
import { buildVirtualLoverPrompt } from './prompt/builder.js';
import { applyVirtualLoverSystemPrompt } from './prompt/system.js';
import { ensureVirtualLoverData, loadPromptBundle } from './state.js';
import { createVirtualLoverProactiveTool, VIRTUAL_LOVER_PROACTIVE_TOOL_NAME } from './proactive-tool.js';
import { createVirtualLoverScheduleProactiveTool, VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME } from './proactive-schedule-tool.js';
import { createVirtualLoverFollowupTool, VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME } from './followup.js';
import { createVirtualLoverBurstSendTool, VIRTUAL_LOVER_BURST_SEND_TOOL_NAME } from './burst-send-tool.js';
import { createVirtualLoverLegacyImportTool, VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME } from './legacy-import-tool.js';
import {
  createLoverMemoryTools,
  MEMORY_SPACES_SERVICE_ID,
  type MemorySpacesServiceLike,
  LOVER_MEMORY_TOOL_NAMES,
} from './memory-tools.js';
import { registerVirtualLoverRoutes } from './web/routes.js';
import { registerVirtualLoverSettingsTab } from './settings-tab.js';

const logger = createPluginLogger('virtual-lover');

interface RuntimeState {
  memoryToolsRegistered: boolean;
  serviceListenerDisposable?: Disposable;
  disposables: Disposable[];
  proactiveToolRegistered: boolean;
  scheduleToolRegistered: boolean;
  followupToolRegistered: boolean;
  burstSendToolRegistered: boolean;
  legacyImportToolRegistered: boolean;
}

const runtimeStates = new Map<string, RuntimeState>();

export default definePlugin({
  name: 'virtual-lover',
  version: '0.1.0',
  description: 'Virtual companion prompt workshop for Iris with isolated lover memory space',

  activate(ctx: PluginContext) {
    const createdConfig = ctx.ensureConfigFile('virtual_lover.yaml', defaultConfigTemplate);
    if (createdConfig) {
      logger.info('已安装 virtual_lover.yaml 默认配置模板');
    }

    const initialConfig = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));

    // 顶层 enabled: false 时直接退出，不注册任何 hook / tool / route。
    // 注：这样做意味着运行期开关切换需要重启 Iris；这是有意为之的简单设计。
    if (!initialConfig.enabled) {
      logger.info('virtual_lover.enabled=false，跳过激活（不注册任何 hook / tool / route）');
      return;
    }

    const dataDir = ctx.getDataDir();
    const extensionRootDir = ctx.getExtensionRootDir();
    ensureVirtualLoverData(dataDir, extensionRootDir, initialConfig.agent.defaultAgentId);

    const runtimeKey = ctx.getConfigDir();
    const runtimeState: RuntimeState = {
      memoryToolsRegistered: false,
      disposables: [],
      proactiveToolRegistered: false,
      scheduleToolRegistered: false,
      followupToolRegistered: false,
      burstSendToolRegistered: false,
      legacyImportToolRegistered: false,
    };
    runtimeStates.set(runtimeKey, runtimeState);
    let memorySpacesService: MemorySpacesServiceLike | undefined;
    const turnsSinceLastLoverExtract = new Map<string, number>();

    const resolveMemorySpacesService = (): MemorySpacesServiceLike | undefined => {
      if (memorySpacesService) return memorySpacesService;
      memorySpacesService = ctx.getServiceRegistry().get<MemorySpacesServiceLike>(MEMORY_SPACES_SERVICE_ID);
      return memorySpacesService;
    };

    ctx.addHook({
      name: 'virtual-lover:prompt',
      priority: initialConfig.prompt.priority,
      async onBeforeLLMCall({ request, round }) {
        try {
          const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
          if (!config.enabled || !config.prompt.enabled) return undefined;
          if (config.prompt.onlyFirstRound && round > 1) return undefined;

          const agentId = config.agent.defaultAgentId;
          const loverMemoryContext = await buildLoverMemoryContext(config, request, resolveMemorySpacesService())
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`lover memory recall 不可用，继续注入基础人设 prompt: ${message}`);
              return undefined;
            });
          const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
          const built = buildVirtualLoverPrompt({
            agentId,
            now: new Date(),
            config,
            bundle,
            loverMemoryContext,
            existingSystemInstruction: request.systemInstruction,
          });

          if (!built.systemText) return undefined;

          return {
            request: applyVirtualLoverSystemPrompt(request, built.systemText, config.prompt.injectionMode),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`提示词注入失败，已回退 Iris 默认请求: ${message}`);
          return undefined;
        }
      },
    });

    ctx.onReady(async (api) => {
      runtimeState.disposables.push(...registerVirtualLoverRoutes(ctx, api, { logger }));
      const settingsDisposable = registerVirtualLoverSettingsTab(ctx, api);
      if (settingsDisposable) runtimeState.disposables.push(settingsDisposable);

      if (!runtimeState.proactiveToolRegistered) {
        ctx.registerTool(createVirtualLoverProactiveTool(ctx, api));
        runtimeState.proactiveToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具已注册`);
      }

      if (!runtimeState.scheduleToolRegistered) {
        ctx.registerTool(createVirtualLoverScheduleProactiveTool(api));
        runtimeState.scheduleToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME} 工具已注册`);
      }

      if (!runtimeState.followupToolRegistered) {
        ctx.registerTool(createVirtualLoverFollowupTool(ctx, api));
        runtimeState.followupToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME} 工具已注册`);
      }

      if (!runtimeState.burstSendToolRegistered) {
        ctx.registerTool(createVirtualLoverBurstSendTool(ctx, api));
        runtimeState.burstSendToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_BURST_SEND_TOOL_NAME} 工具已注册`);
      }

      if (!runtimeState.legacyImportToolRegistered) {
        ctx.registerTool(createVirtualLoverLegacyImportTool(ctx, api));
        runtimeState.legacyImportToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME} 工具已注册`);
      }

      const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
      if (config.memory.tools.enabled) {
        const registerLoverMemoryTools = (service: MemorySpacesServiceLike) => {
          if (runtimeState.memoryToolsRegistered) return;
          memorySpacesService = service;
          ctx.registerTools(createLoverMemoryTools(() => {
            const latest = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
            return memorySpacesService!.getOrCreateSpace(latest.memory.space);
          }));
          logger.info(`Lover memory tools 已注册，space=${config.memory.space}`);
          runtimeState.memoryToolsRegistered = true;
        };

        const existingService = api.services.get<MemorySpacesServiceLike>(MEMORY_SPACES_SERVICE_ID);
        if (existingService) {
          registerLoverMemoryTools(existingService);
        } else {
          runtimeState.serviceListenerDisposable = api.services.onDidRegister((descriptor) => {
            if (descriptor.id !== MEMORY_SPACES_SERVICE_ID) return;
            const service = api.services.get<MemorySpacesServiceLike>(MEMORY_SPACES_SERVICE_ID);
            if (service) registerLoverMemoryTools(service);
          });
          logger.info('memory.spaces service 尚未就绪，已等待其注册后再启用 lover memory tools');
        }
      }
    });

    ctx.addHook({
      name: 'virtual-lover:auto-extract-memory',
      priority: 60,
      onAfterChat({ sessionId }) {
        const config = parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
        if (!config.enabled || !config.memory.autoExtract) return undefined;

        const interval = Math.max(1, config.memory.extractInterval);
        const nextCount = (turnsSinceLastLoverExtract.get(sessionId) ?? 0) + 1;
        if (nextCount < interval) {
          turnsSinceLastLoverExtract.set(sessionId, nextCount);
          return undefined;
        }
        turnsSinceLastLoverExtract.set(sessionId, 0);

        const service = resolveMemorySpacesService();
        const space = service?.getOrCreateSpace(config.memory.space);
        if (!space?.extractFromSession) return undefined;

        void space.extractFromSession({ sessionId }).then((result) => {
          if (result.savedCount > 0) {
            logger.info(`lover memory 自动提取完成: ${result.savedCount} 条 (session=${sessionId}, space=${config.memory.space})`);
          }
        }).catch((error) => {
          logger.warn(`lover memory 自动提取失败 (session=${sessionId}):`, error);
        });
        return undefined;
      },
    });

    logger.info('Virtual Lover extension 已启用（prompt/web + Iris memory space）');
  },

  deactivate(ctx?: PluginContext) {
    if (!ctx) return;
    const runtimeKey = ctx.getConfigDir();
    const runtimeState = runtimeStates.get(runtimeKey);
    runtimeState?.serviceListenerDisposable?.dispose();
    for (const disposable of runtimeState?.disposables.splice(0).reverse() ?? []) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_PROACTIVE_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_BURST_SEND_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME);
    for (const name of LOVER_MEMORY_TOOL_NAMES) {
      ctx.getToolRegistry().unregister?.(name);
    }
    runtimeStates.delete(runtimeKey);
  },
});

async function buildLoverMemoryContext(
  config: VirtualLoverConfig,
  request: LLMRequest,
  memorySpacesService: MemorySpacesServiceLike | undefined,
): Promise<string | undefined> {
  if (!config.memory.autoInject || !memorySpacesService) return undefined;
  const userText = extractLastUserText(request.contents);
  if (!userText) return undefined;

  const space = memorySpacesService.getOrCreateSpace(config.memory.space);
  if (!space.buildContext) return undefined;
  const result = await space.buildContext({
    userText,
    maxBytes: config.memory.maxRecallBytes,
  });
  return result?.text;
}

function extractLastUserText(contents: Content[]): string {
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (content.role !== 'user') continue;
    const text = extractText(content.parts).trim();
    if (text) return text;
  }
  return '';
}
