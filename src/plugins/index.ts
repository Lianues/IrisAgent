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
export { PluginCommandRegistry } from './command-registry';
export type { PluginCommand, CommandContext } from './command-registry';
export { patchMethod, patchPrototype } from './patch';
export type { PatchDisposer } from './patch';
