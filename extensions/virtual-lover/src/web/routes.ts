import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IrisAPI, PluginContext, PluginLogger } from 'irises-extension-sdk';
import { parseVirtualLoverConfig } from '../config.js';
import { buildVirtualLoverPrompt } from '../prompt/builder.js';
import { sendProactiveMessage } from '../proactive.js';
import { buildPanelHTML } from './html.js';
import {
  DEFAULT_AGENT_ID,
  FRAGMENT_NAMES,
  ensureVirtualLoverData,
  isFragmentName,
  listVirtualLoverAgents,
  loadPromptBundle,
  readAllFragments,
  readFragment,
  sanitizeVirtualLoverSegment,
  writeFragment,
} from '../state.js';

interface RegisterVirtualLoverRoutesOptions {
  logger: PluginLogger;
}

export function registerVirtualLoverRoutes(
  ctx: PluginContext,
  api: IrisAPI,
  options: RegisterVirtualLoverRoutesOptions,
): void {
  const logger = options.logger;
  const config = readCurrentConfig(ctx);

  if (!config.web.enabled) {
    logger.info('Virtual Lover Web 面板已禁用（web.enabled: false）');
    return;
  }

  const registerRoute = api.registerWebRoute;
  if (!registerRoute) {
    logger.warn('宿主未提供 registerWebRoute，Virtual Lover Web 面板不可用');
    return;
  }

  const basePath = config.web.basePath;
  const dataDir = ctx.getDataDir();
  const extensionRootDir = ctx.getExtensionRootDir();

  api.registerWebPanel?.({
    id: 'virtual-lover',
    title: 'Virtual Lover',
    icon: 'favorite',
    contentPath: `${basePath}/panel`,
  });

  registerRoute('GET', `${basePath}/health`, async (_req: any, res: any) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      ok: true,
      name: 'virtual-lover',
      version: '0.1.0',
      dataReady: true,
      basePath,
      memory: {
        managedBy: 'iris-memory-extension:memory.spaces',
        space: currentConfig.memory.space,
        available: api.services.has('memory.spaces'),
      },
    });
  });

  registerRoute('GET', `${basePath}/panel`, async (_req: any, res: any) => {
    sendText(res, 200, buildPanelHTML(basePath), 'text/html; charset=utf-8');
  });

  registerRoute('GET', `${basePath}/assets/app.js`, async (_req: any, res: any) => {
    serveAsset(res, extensionRootDir, 'web/app.js', 'application/javascript; charset=utf-8');
  });

  registerRoute('GET', `${basePath}/assets/styles.css`, async (_req: any, res: any) => {
    serveAsset(res, extensionRootDir, 'web/styles.css', 'text/css; charset=utf-8');
  });

  registerRoute('GET', `${basePath}/config`, async (_req: any, res: any) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      config: currentConfig,
      memory: {
        managedBy: 'iris-memory-extension:memory.spaces',
        space: currentConfig.memory.space,
        available: api.services.has('memory.spaces'),
        note: 'lover 记忆与主记忆分离，存储/检索/dream 由 Iris memory extension 的 memory.spaces service 提供。',
      },
      proactive: {
        enabled: currentConfig.proactive.enabled,
        platform: currentConfig.proactive.platform,
        binding: currentConfig.proactive.binding,
        target: currentConfig.proactive.target,
        deliveryAvailable: api.services.has('delivery.registry'),
      },
    });
  });

  registerRoute('GET', `${basePath}/proactive/status`, async (_req: any, res: any) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      enabled: currentConfig.proactive.enabled,
      platform: currentConfig.proactive.platform,
      binding: currentConfig.proactive.binding,
      target: currentConfig.proactive.target,
      deliveryAvailable: api.services.has('delivery.registry'),
      memorySpace: currentConfig.memory.space,
      memoryAvailable: api.services.has('memory.spaces'),
    });
  });

  registerRoute('GET', `${basePath}/agents`, async (_req: any, res: any) => {
    ensureVirtualLoverData(dataDir, extensionRootDir, readCurrentConfig(ctx).agent.defaultAgentId);
    sendJson(res, 200, { agents: listVirtualLoverAgents(dataDir) });
  });

  registerRoute('GET', `${basePath}/agents/:agentId/fragments`, async (_req: any, res: any, params: Record<string, string>) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
      sendJson(res, 200, { agentId, fragments: readAllFragments(paths), names: FRAGMENT_NAMES });
    } catch (error) {
      sendError(res, error);
    }
  });

  registerRoute('GET', `${basePath}/agents/:agentId/fragments/:name`, async (_req: any, res: any, params: Record<string, string>) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const name = normalizeFragmentName(params.name);
      sendJson(res, 200, { agentId, name, content: readFragment(dataDir, extensionRootDir, agentId, name) });
    } catch (error) {
      sendError(res, error);
    }
  });

  registerRoute('PUT', `${basePath}/agents/:agentId/fragments/:name`, async (req: any, res: any, params: Record<string, string>) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const name = normalizeFragmentName(params.name);
      const body = await readJsonBody(req);
      const content = readContentBody(body);
      writeFragment(dataDir, extensionRootDir, agentId, name, content);
      sendJson(res, 200, { ok: true, agentId, name });
    } catch (error) {
      sendError(res, error);
    }
  });

  registerRoute('POST', `${basePath}/agents/:agentId/preview`, async (_req: any, res: any, params: Record<string, string>) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const currentConfig = readCurrentConfig(ctx);
      const bundle = loadPromptBundle(dataDir, extensionRootDir, agentId);
      const preview = buildVirtualLoverPrompt({
        agentId,
        now: new Date(),
        config: currentConfig,
        bundle,
      });
      sendJson(res, 200, preview);
    } catch (error) {
      sendError(res, error);
    }
  });

  registerRoute('POST', `${basePath}/agents/:agentId/init-defaults`, async (_req: any, res: any, params: Record<string, string>) => {
    try {
      const agentId = normalizeAgentId(params.agentId || DEFAULT_AGENT_ID);
      ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
      sendJson(res, 200, { ok: true, bundle: loadPromptBundle(dataDir, extensionRootDir, agentId) });
    } catch (error) {
      sendError(res, error);
    }
  });

  registerRoute('POST', `${basePath}/proactive/send`, async (req: any, res: any) => {
    try {
      const body = await readJsonBody(req);
      const currentConfig = readCurrentConfig(ctx);
      const agentId = currentConfig.agent.defaultAgentId;
      const bundle = loadPromptBundle(dataDir, extensionRootDir, agentId);
      const result = await sendProactiveMessage({
        config: currentConfig,
        api,
        bundle,
        agentId,
        text: typeof body.text === 'string' ? body.text : undefined,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        dryRun: body.dryRun === true,
      });
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendError(res, error);
    }
  });

  logger.info(`Virtual Lover Web 面板已注册: ${basePath}/panel`);
}

function readCurrentConfig(ctx: PluginContext) {
  return parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover'));
}

function normalizeAgentId(value: string | undefined): string {
  return sanitizeVirtualLoverSegment(value || DEFAULT_AGENT_ID, 'agentId');
}

function normalizeFragmentName(value: string | undefined) {
  const name = value ?? '';
  if (!isFragmentName(name)) {
    throw new Error(`未知 fragment: ${name}`);
  }
  return name;
}

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON object');
  }
  return parsed as Record<string, unknown>;
}

function readContentBody(body: Record<string, unknown>): string {
  if (typeof body.content !== 'string') {
    throw new Error('请求体需要包含字符串字段 content');
  }
  return body.content;
}

function serveAsset(res: any, extensionRootDir: string | undefined, relativePath: string, contentType: string): void {
  if (!extensionRootDir) {
    sendJson(res, 404, { error: 'extensionRootDir 不可用' });
    return;
  }
  const filePath = path.join(extensionRootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: `资源不存在: ${relativePath}` });
    return;
  }
  sendText(res, 200, fs.readFileSync(filePath, 'utf-8'), contentType);
}

function sendJson(res: any, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: any, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: any, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 400, { error: message });
}
