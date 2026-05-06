/**
 * 扩展系统统一导出
 */

// ── 扩展发现 / 安装 / 注册 ─────────────────────────────────────

export {
  discoverLocalExtensions,
  discoverLocalPluginEntries,
  mergePluginEntries,
  importLocalExtensionModule,
  registerExtensionPlatforms,
  resolveLocalPluginSource,
  ensureDevSourceSdkShims,
} from './registry';

export type { ExtensionDiscoveryOptions } from './registry';

export {
  deleteInstalledExtension,
  inspectGitExtensionUpdate,
  installExtension,
  installGitExtension,
  installLocalExtension,
  updateGitExtension,
  resolveScopeInstallDir,
} from 'irises-extension-sdk/utils';

export { getRemoteExtensionInstallIndexUrl as getRemoteExtensionIndexUrl } from 'irises-extension-sdk/utils';

export type {
  ExtensionInstallOptions,
  GitExtensionInstallOptions,
  GitExtensionUpdateOptions,
  GitExtensionUpdatePreviewResult,
  InstallScope,
} from 'irises-extension-sdk/utils';

// ── 插件系统实现 ───────────────────────────────────────────

export { PluginManager } from './manager';
export { PluginEventBus } from './event-bus';
export { patchMethod, patchPrototype } from './patch';
export { ServiceRegistry } from './service-registry';
export { ConfigContributionRegistry } from './config-contribution-registry';
export { DeliveryRegistry } from './delivery-registry';

// ── 宿主内部类型 ─────────────────────────────────────────────

export type {
  LoadedPlugin,
  PluginInfo,
  BeforeToolExecInterceptor,
  AfterToolExecInterceptor,
  BeforeLLMCallInterceptor,
  AfterLLMCallInterceptor,
} from './types';

// ── SDK 类型便捷 re-export（让宿主其他模块 from './extension' 也能拿到）

export type {
  IrisPlugin,
  IrisAPI,
  PreBootstrapContext,
  PluginContext,
  PluginHook,
  PluginLogger,
  InlinePluginEntry,
  PluginEntry,
  ToolExecInterception,
  ToolWrapper,
  WebPanelDefinition,
  PatchDisposer,
  Disposable,
  ServiceDescriptor,
  ServiceRegistryLike,
  ConfigContribution,
  ConfigContributionRegistryLike,
  ConfigFieldSchema,
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPluginContribution,
  ExtensionSource,
  ResolvedLocalPlugin,
  ExtensionInstallFallbackReason,
  ExtensionDistributionMode,
  InstalledExtensionResult,
} from 'irises-extension-sdk';

export type {
  BootstrapExtensionRegistry,
  LLMProviderFactory,
  StorageFactory,
} from '../bootstrap/extensions';
