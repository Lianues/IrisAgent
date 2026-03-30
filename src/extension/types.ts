/**
 * 插件系统类型定义
 *
 * 公共类型全部来自 @irises/extension-sdk，此处仅 re-export 并补充宿主内部专用类型。
 */

import type { Content, LLMRequest } from '../types';
import type { PlatformAdapter } from '@irises/extension-sdk';

// ── 公共类型：全部从 SDK re-export ─────────────────────────────

export type {
  IrisAPI,
  IrisPlugin,
  PluginContext,
  PreBootstrapContext,
  PluginHook,
  ToolWrapper,
  ToolExecInterception,
  PluginLogger,
  PluginEntry,
  InlinePluginEntry,
  WebPanelDefinition,
  PatchDisposer,
} from '@irises/extension-sdk';

// ── 宿主内部类型（不导出给扩展） ───────────────────────────────

import type { IrisAPI, PluginHook } from '@irises/extension-sdk';

/** 已加载的插件实例（PluginManager 内部） */
export interface LoadedPlugin {
  entry: import('@irises/extension-sdk').PluginEntry;
  plugin: import('@irises/extension-sdk').IrisPlugin;
  hooks: PluginHook[];
  readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>>;
  platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>>;
}

/** 插件信息（公开查询用） */
export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: 'local' | 'npm' | 'inline';
  priority: number;
  hookCount: number;
}

// ── 拦截器类型（Backend 内部使用） ─────────────────────────────

export type BeforeToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<import('@irises/extension-sdk').ToolExecInterception | undefined>;

export type AfterToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  durationMs: number,
) => Promise<{ result: unknown } | undefined>;

export type BeforeLLMCallInterceptor = (
  request: LLMRequest,
  round: number,
) => Promise<{ request: LLMRequest } | undefined>;

export type AfterLLMCallInterceptor = (
  content: Content,
  round: number,
) => Promise<{ content: Content } | undefined>;
