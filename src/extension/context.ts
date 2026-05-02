/**
 * 插件上下文实现
 *
 * 每个插件在激活时获得一个独立的 PluginContext 实例。
 * 提供便捷 API 和对内部对象的直接访问。
 */

import type { ToolDefinition, Part } from '../types';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';
import type { ToolRegistry } from '../tools/registry';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { LLMRouter } from '../llm/router';
import type { PluginContext, PluginHook, PluginLogger, ToolWrapper, IrisAPI, PluginEventBusLike, PluginManagerLike, ServiceRegistryLike, ConfigContributionRegistryLike, GlobalStoreLike, Disposable } from 'irises-extension-sdk';
import { createLogger } from '../logger';
import type { PlatformAdapter } from 'irises-extension-sdk';

export class PluginContextImpl {
  private hooks: PluginHook[] = [];
  private readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>> = [];
  private _platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> = [];
  private registeredToolNames = new Set<string>();
  private systemPromptParts: Part[] = [];
  private disposables: Disposable[] = [];
  private disposed = false;

  constructor(
    private pluginName: string,
    private toolRegistry: ToolRegistry,
    private modeRegistry: ModeRegistry,
    private router: LLMRouter,
    private appConfig: AppConfig,
    private promptAssembler: PromptAssembler,
    private _serviceRegistry: ServiceRegistryLike,
    private _configContributions: ConfigContributionRegistryLike,
    private _globalStore: GlobalStoreLike,
    private pluginConfig?: Record<string, unknown>,
    private extensionRootDir?: string,
    private configDir?: string,
  ) {}

  // ---- 工具扩展 ----

  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
    this.registeredToolNames.add(tool.declaration.name);
  }

  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) this.registerTool(tool);
  }

  // ---- 模式扩展 ----

  registerMode(mode: ModeDefinition): void {
    this.modeRegistry.register(mode);
  }

  // ---- 事件钩子 ----

  addHook(hook: PluginHook): void {
    this.hooks.push(hook);
  }

  // ---- 直接访问内部注册表 ----

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getModeRegistry(): ModeRegistry {
    return this.modeRegistry;
  }

  getRouter(): LLMRouter {
    return this.router;
  }

  // ---- 工具拦截 ----

  wrapTool(toolName: string, wrapper: ToolWrapper): void {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`wrapTool: 工具 "${toolName}" 未注册`);
    }
    const originalHandler = tool.handler;
    const wrappedHandler = (args: Record<string, unknown>, context?: unknown) => wrapper(originalHandler, args, toolName);
    tool.handler = wrappedHandler as typeof tool.handler;
    this.disposables.push({
      dispose: () => {
        if (tool.handler === wrappedHandler) tool.handler = originalHandler;
      },
    });
  }

  // ---- 提示词操作 ----

  addSystemPromptPart(part: Part): void {
    this.promptAssembler.addSystemPart(part);
    this.systemPromptParts.push(part);
  }

  removeSystemPromptPart(part: Part): void {
    this.promptAssembler.removeSystemPart(part);
    const index = this.systemPromptParts.indexOf(part);
    if (index >= 0) this.systemPromptParts.splice(index, 1);
  }

  trackDisposable(disposable: Disposable | undefined | null): void {
    if (!disposable) return;
    if (this.disposed) {
      try { disposable.dispose(); } catch { /* ignore */ }
      return;
    }
    this.disposables.push(disposable);
  }

  // ---- 延迟初始化 ----

  onReady(callback: (api: IrisAPI) => void | Promise<void>): void {
    this.readyCallbacks.push(callback);
  }

  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void {
    this._platformReadyCallbacks.push(callback);
  }

  // ---- 工具方法 ----

  getConfig(): Readonly<AppConfig> {
    return this.appConfig;
  }

  getLogger(tag?: string): PluginLogger {
    const prefix = tag
      ? `Plugin:${this.pluginName}:${tag}`
      : `Plugin:${this.pluginName}`;
    return createLogger(prefix);
  }

  getPluginConfig<T = Record<string, unknown>>(): T | undefined {
    return this.pluginConfig as T | undefined;
  }

  getExtensionRootDir(): string | undefined {
    return this.extensionRootDir;
  }

  // ---- 配置文件管理 ----

  getConfigDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    return this.configDir;
  }

  getDataDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    // configDir = <dataDir>/configs/ → dataDir = parent
    const dataDir = path.dirname(this.configDir);
    const dir = path.join(dataDir, 'extension-data', this.pluginName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  ensureConfigFile(filename: string, content: string): boolean {
    if (!this.configDir) throw new Error('configDir 未设置');
    const filePath = path.join(this.configDir, filename);
    if (fs.existsSync(filePath)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  readConfigSection(section: string): Record<string, unknown> | undefined {
    if (!this.configDir) return undefined;
    const filePath = path.join(this.configDir, `${section}.yaml`);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (parseYAML(raw) as Record<string, unknown>) ?? undefined;
  }

  // ---- 插件间协作 ----

  private _eventBus?: PluginEventBusLike;
  private _pluginManager?: PluginManagerLike;

  /** 注入事件总线和插件管理器引用（由 PluginManager 在 activate 后调用） */
  setInteropRefs(eventBus: PluginEventBusLike, pluginManager: PluginManagerLike): void {
    this._eventBus = eventBus;
    this._pluginManager = pluginManager;
  }

  getEventBus(): PluginEventBusLike {
    if (!this._eventBus) throw new Error('EventBus 尚未就绪，请在 onReady 回调中访问');
    return this._eventBus;
  }

  getPluginManager(): PluginManagerLike {
    if (!this._pluginManager) throw new Error('PluginManager 尚未就绪，请在 onReady 回调中访问');
    return this._pluginManager;
  }

  setHookPriority(hookName: string, priority: number): boolean {
    const hook = this.hooks.find(h => h.name === hookName);
    if (!hook) return false;
    hook.priority = priority;
    return true;
  }

  // ---- 服务与配置注册中心 ----

  getServiceRegistry(): ServiceRegistryLike {
    return this._serviceRegistry;
  }

  getConfigContributions(): ConfigContributionRegistryLike {
    return this._configContributions;
  }

  getGlobalStore(): GlobalStoreLike {
    return this._globalStore;
  }

  // ---- 内部方法（供 PluginManager 使用） ----

  /** 获取插件注册的所有钩子 */
  getHooks(): PluginHook[] {
    return this.hooks;
  }

  /** 获取插件注册的 onReady 回调 */
  getReadyCallbacks(): Array<(api: IrisAPI) => void | Promise<void>> {
    return this.readyCallbacks;
  }

  /** 获取插件注册的 onPlatformsReady 回调 */
  getPlatformReadyCallbacks(): Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> {
    return this._platformReadyCallbacks;
  }

  /** 自动释放通过 PluginContext 注册的资源。由 PluginManager 在插件 deactivate 后调用。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (let i = this.disposables.length - 1; i >= 0; i--) {
      try { this.disposables[i]?.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];

    for (let i = this.systemPromptParts.length - 1; i >= 0; i--) {
      try { this.promptAssembler.removeSystemPart(this.systemPromptParts[i]); } catch { /* ignore */ }
    }
    this.systemPromptParts = [];

    for (const name of this.registeredToolNames) {
      try { this.toolRegistry.unregister(name); } catch { /* ignore */ }
    }
    this.registeredToolNames.clear();

    this.hooks = [];
    this.readyCallbacks = [];
    this._platformReadyCallbacks = [];
  }
}
