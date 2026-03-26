/**
 * 插件系统统一导出
 */

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
