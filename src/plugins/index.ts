/**
 * 插件系统统一导出
 */

export type {
  IrisPlugin,
  PluginContext,
  PluginHook,
  PluginLogger,
  PluginEntry,
  PluginInfo,
  ToolExecInterception,
} from './types';

export { PluginManager } from './manager';
