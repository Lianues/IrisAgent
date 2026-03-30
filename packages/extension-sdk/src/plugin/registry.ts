import type { Part } from '../message.js';
import type { ModeDefinition } from '../mode.js';
import type { IrisModelInfoLike } from '../platform.js';
import type { ToolDefinition } from '../tool.js';

export interface ToolRegistryLike {
  register(tool: ToolDefinition): void;
  registerAll(tools: ToolDefinition[]): void;
  unregister?(name: string): boolean;
  get?(name: string): ToolDefinition | undefined;
}

export interface ModeRegistryLike {
  register(mode: ModeDefinition): void;
  registerAll?(modes: ModeDefinition[]): void;
}

export interface LLMRouterLike {
  getCurrentModelInfo?(): IrisModelInfoLike | undefined;
  listModels?(): IrisModelInfoLike[];
  resolve?(modelName: string): unknown;
  /** 检查模型是否已注册 */
  hasModel?(modelName: string): boolean;
  /** 动态注册一个模型（modelName 不可重复） */
  registerModel?(entry: { modelName: string; provider: unknown; config: Record<string, unknown> }): void;
  /** 动态移除一个模型（至少需保留一个模型） */
  unregisterModel?(modelName: string): boolean;
  /** 切换当前活动模型 */
  setCurrentModel?(modelName: string): unknown;
  /** 获取当前活动模型名称 */
  getCurrentModelName?(): string;
  /** 获取指定模型的配置（不传参数时获取当前模型） */
  getModelConfig?(modelName?: string): Record<string, unknown>;
}

export interface PromptAssemblerLike {
  addSystemPart(part: Part): void;
  removeSystemPart(part: Part): void;
  setSystemPrompt?(prompt: string): void;
}

export interface PluginEventBusLike {
  emit?(event: string, ...args: unknown[]): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  /** 发射事件（emit 的别名，语义更清晰） */
  fire?(event: string, ...args: unknown[]): void;
}

/** 插件信息（查询用） */
export interface PluginInfoLike {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: string;
  priority: number;
  hookCount: number;
}

export interface PluginManagerLike {
  /** 列出所有已加载的插件信息 */
  listPlugins?(): PluginInfoLike[];
  /** 根据名称查找指定插件 */
  getPlugin?(name: string): PluginInfoLike | undefined;
  /** 获取已加载插件数量 */
  readonly size?: number;
}
