/**
 * 插件系统类型定义
 *
 * 插件拥有对 Iris 内部组件的完整访问权限。
 * 由于插件与 Iris 在同一进程中运行，可以直接操作内部对象。
 */

import type { ToolDefinition, ToolHandler, Part } from '../types';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';
import type { ToolRegistry } from '../tools/registry';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { StorageProvider } from '../storage/base';
import type { MemoryProvider } from '../memory/base';
import type { LLMRouter } from '../llm/router';
import type { Backend } from '../core/backend';

// ============ 插件定义 ============

/** Iris 插件接口 */
export interface IrisPlugin {
  /** 插件唯一标识 */
  name: string;
  /** 版本号 */
  version: string;
  /** 插件描述 */
  description?: string;

  /**
   * 插件激活。
   * 在 bootstrap 流程中、Backend 创建之前调用。
   * 插件在此方法中注册工具、模式、钩子等。
   */
  activate(context: PluginContext): Promise<void> | void;

  /**
   * 插件停用（可选）。
   * 在应用关闭时调用，用于释放资源。
   */
  deactivate?(): Promise<void> | void;
}

// ============ 内部 API ============

/**
 * Iris 内部 API
 *
 * 在 Backend 创建完成后通过 onReady 回调传递给插件。
 * 提供对所有核心组件的直接访问，不做任何限制。
 */
export interface IrisAPI {
  /** Backend 实例（EventEmitter，可监听所有内部事件、调用所有方法） */
  backend: Backend;
  /** LLM 路由器（切换模型、获取模型信息） */
  router: LLMRouter;
  /** 存储层（会话历史、元数据） */
  storage: StorageProvider;
  /** 记忆层（可选） */
  memory?: MemoryProvider;
  /** 工具注册表 */
  tools: ToolRegistry;
  /** 模式注册表 */
  modes: ModeRegistry;
  /** 提示词装配器（可直接修改系统提示词） */
  prompt: PromptAssembler;
}

// ============ 插件上下文 ============

/**
 * 插件上下文
 *
 * 插件通过此对象与 Iris 交互。
 * 提供便捷 API 和对内部对象的直接访问。
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

  /** 注册钩子 */
  addHook(hook: PluginHook): void;

  // ---- 直接访问内部注册表 ----

  /** 获取 ToolRegistry 实例（可直接调用 register/unregister/get/createSubset 等方法） */
  getToolRegistry(): ToolRegistry;
  /** 获取 ModeRegistry 实例 */
  getModeRegistry(): ModeRegistry;

  // ---- 工具拦截 ----

  /**
   * 包装已注册工具的 handler。
   * wrapper 接收原始 handler、参数和工具名，返回执行结果。
   * 可多次包装同一个工具，形成洋葱式调用链。
   */
  wrapTool(toolName: string, wrapper: ToolWrapper): void;

  // ---- 提示词操作 ----

  /** 向系统提示词追加一个片段（持久生效，所有请求可见） */
  addSystemPromptPart(part: Part): void;
  /** 移除之前追加的系统提示词片段（按引用匹配） */
  removeSystemPromptPart(part: Part): void;

  // ---- 延迟初始化 ----

  /**
   * 注册 Backend 创建完成后的回调。
   * 回调接收 IrisAPI 参数，包含所有核心组件的引用。
   * 可通过 api.backend.on(...) 监听事件，调用任意方法。
   */
  onReady(callback: (api: IrisAPI) => void | Promise<void>): void;

  // ---- 工具方法 ----

  /** 获取当前应用配置（只读） */
  getConfig(): Readonly<AppConfig>;
  /** 获取插件专属的日志器 */
  getLogger(tag?: string): PluginLogger;
  /** 读取插件配置（插件目录 config.yaml + plugins.yaml 中 config 字段的合并结果） */
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;
}

// ============ 工具拦截 ============

/** 工具包装器类型 */
export type ToolWrapper = (
  original: ToolHandler,
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;

// ============ 钩子系统 ============

/** 插件钩子 */
export interface PluginHook {
  /** 钩子名称（用于日志标识） */
  name: string;

  /**
   * 消息预处理：在用户消息发给 LLM 前调用。
   * 返回 { text } 替换消息文本，返回 undefined 不修改。
   */
  onBeforeChat?(params: {
    sessionId: string;
    text: string;
  }): Promise<{ text: string } | undefined> | { text: string } | undefined;

  /**
   * 响应后处理：在 LLM 返回最终内容后调用。
   * 返回 { content } 替换响应文本，返回 undefined 不修改。
   */
  onAfterChat?(params: {
    sessionId: string;
    content: string;
  }): Promise<{ content: string } | undefined> | { content: string } | undefined;

  /**
   * 工具执行前拦截：可阻止执行或修改参数。
   * 返回 { blocked: true, reason } 阻止执行。
   * 返回 { blocked: false, args } 修改参数。
   * 返回 undefined 不干预。
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

/**
 * 工具执行前拦截器（内部使用）
 *
 * 由 Backend 从 PluginHook[] 组合生成，注入到 ToolLoopConfig。
 */
export type BeforeToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolExecInterception | undefined>;

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
  name: string;
  type?: 'local' | 'npm';
  enabled?: boolean;
  config?: Record<string, unknown>;
}

// ============ 内部类型 ============

/** 已加载的插件实例 */
export interface LoadedPlugin {
  entry: PluginEntry;
  plugin: IrisPlugin;
  hooks: PluginHook[];
  readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>>;
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
