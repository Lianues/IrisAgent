/**
 * 插件系统类型定义
 *
 * 定义插件接口、上下文、钩子和配置等核心类型。
 */

import type { ToolDefinition } from '../types/tool';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';

// ============ 插件定义 ============

/** Iris 插件接口 */
export interface IrisPlugin {
  /** 插件唯一标识（推荐格式：作者/插件名，如 "iris/weather-tool"） */
  name: string;

  /** 版本号 */
  version: string;

  /** 插件描述 */
  description?: string;

  /**
   * 插件激活。
   * 在 bootstrap 流程中、Backend 创建之前调用。
   * 插件在此方法中向 context 注册工具、模式等。
   */
  activate(context: PluginContext): Promise<void> | void;

  /**
   * 插件停用（可选）。
   * 在应用关闭时调用，用于释放资源（如关闭连接、清理定时器）。
   */
  deactivate?(): Promise<void> | void;
}

// ============ 插件上下文 ============

/**
 * 插件上下文接口
 *
 * 插件通过此对象与 Iris 交互。这是插件能力的边界。
 */
export interface PluginContext {
  // ---- 工具扩展 ----

  /** 注册一个工具 */
  registerTool(tool: ToolDefinition): void;

  /** 批量注册工具 */
  registerTools(tools: ToolDefinition[]): void;

  // ---- 模式扩展 ----

  /** 注册一个自定义模式 */
  registerMode(mode: ModeDefinition): void;

  // ---- 事件钩子 ----

  /** 注册钩子（可在关键流程节点插入自定义逻辑） */
  addHook(hook: PluginHook): void;

  // ---- 工具方法 ----

  /** 获取当前应用配置（只读） */
  getConfig(): Readonly<AppConfig>;

  /** 获取插件专属的日志器 */
  getLogger(tag?: string): PluginLogger;

  /** 读取插件的配置（合并插件目录 config.yaml + plugins.yaml 中的覆盖） */
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;
}

// ============ 钩子系统 ============

/** 插件钩子 */
export interface PluginHook {
  /** 钩子名称（用于日志标识） */
  name: string;

  /**
   * 消息预处理：在用户消息发给 LLM 前调用。
   * 可修改消息文本，返回修改后的文本。
   * 返回 undefined 表示不修改。
   */
  onBeforeChat?(params: {
    sessionId: string;
    text: string;
  }): Promise<{ text: string } | undefined> | { text: string } | undefined;

  /**
   * 响应后处理：在 LLM 返回最终内容后调用。
   * 可修改响应内容。返回 undefined 表示不修改。
   */
  onAfterChat?(params: {
    sessionId: string;
    content: string;
  }): Promise<{ content: string } | undefined> | { content: string } | undefined;

  /**
   * 工具执行前拦截：可阻止工具执行或修改参数。
   * 返回 { blocked: true, reason } 可阻止执行。
   * 返回 undefined 表示不干预。
   */
  onBeforeToolExec?(params: {
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<ToolExecInterception | undefined> | ToolExecInterception | undefined;
}

/** 工具执行拦截结果 */
export type ToolExecInterception =
  | { blocked: true; reason: string }
  | { blocked: false; args?: Record<string, unknown> };

// ============ 日志 ============

/** 插件日志器接口 */
export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// ============ 配置 ============

/** 插件配置条目（对应 plugins.yaml 中的一项） */
export interface PluginEntry {
  /** 插件名称 */
  name: string;
  /** 插件来源类型，默认 local */
  type?: 'local' | 'npm';
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 插件配置覆盖（合并到插件自身的 config.yaml） */
  config?: Record<string, unknown>;
}

// ============ 内部类型 ============

/** 已加载的插件实例（内部使用） */
export interface LoadedPlugin {
  entry: PluginEntry;
  plugin: IrisPlugin;
  hooks: PluginHook[];
}

/** 插件信息（公开查询用） */
export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: 'local' | 'npm' | 'inline';
  hookCount: number;
}
