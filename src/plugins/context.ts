/**
 * 插件上下文实现
 *
 * 每个插件在激活时获得一个独立的 PluginContext 实例。
 * 上下文封装了插件可用的所有注册和查询能力。
 */

import type { ToolDefinition } from '../types/tool';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';
import type { ToolRegistry } from '../tools/registry';
import type { ModeRegistry } from '../modes/registry';
import type { PluginContext, PluginHook, PluginLogger } from './types';
import { createLogger } from '../logger';

export class PluginContextImpl implements PluginContext {
  private hooks: PluginHook[] = [];

  constructor(
    private pluginName: string,
    private toolRegistry: ToolRegistry,
    private modeRegistry: ModeRegistry,
    private appConfig: AppConfig,
    private pluginConfig?: Record<string, unknown>,
  ) {}

  // ---- 工具扩展 ----

  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  registerTools(tools: ToolDefinition[]): void {
    this.toolRegistry.registerAll(tools);
  }

  // ---- 模式扩展 ----

  registerMode(mode: ModeDefinition): void {
    this.modeRegistry.register(mode);
  }

  // ---- 事件钩子 ----

  addHook(hook: PluginHook): void {
    this.hooks.push(hook);
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

  // ---- 内部方法（供 PluginManager 使用） ----

  /** 获取插件注册的所有钩子 */
  getHooks(): PluginHook[] {
    return this.hooks;
  }
}
