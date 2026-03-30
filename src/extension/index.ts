/**
 * 扩展系统统一导出
 *
 * 合并了原 extension/ 和 plugins/ 的全部导出。
 */

// ── 扩展发现 / 安装 / 注册 ─────────────────────────────────────

export type {
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPluginContribution,
  ExtensionSource,
  ResolvedLocalPlugin,
  ExtensionInstallFallbackReason,
  ExtensionDistributionMode,
  InstalledExtensionResult,
} from './manifest-types';

export {
  discoverLocalExtensions,
  importLocalExtensionModule,
  registerExtensionPlatforms,
  resolveLocalPluginSource,
} from './registry';

export {
  getRemoteExtensionIndexUrl,
  installExtension,
  installLocalExtension,
} from './installer';

export type { ExtensionInstallOptions } from './installer';

// ── 插件系统 ───────────────────────────────────────────────────

export type {
  IrisPlugin,
  IrisAPI,
  PreBootstrapContext,
  PluginContext,
  PluginHook,
  PluginLogger,
  InlinePluginEntry,
  PluginEntry,
  PluginInfo,
  ToolExecInterception,
  ToolWrapper,
  BeforeToolExecInterceptor,
  AfterToolExecInterceptor,
  BeforeLLMCallInterceptor,
  AfterLLMCallInterceptor,
} from './types';

export type {
  BootstrapExtensionRegistry,
  LLMProviderFactory,
  StorageFactory,
  MemoryFactory,
  OCRFactory,
} from '../bootstrap/extensions';

export { PluginManager } from './manager';
export { PluginEventBus } from './event-bus';
export { patchMethod, patchPrototype } from './patch';
export type { PatchDisposer } from './patch';
