/**
 * 模式模块统一入口
 */

export type { ModeDefinition, ToolFilter } from './types';
export { ModeRegistry } from './registry';

import { ModeDefinition } from './types';
import { ToolRegistry } from '../tools/registry';

/**
 * 根据模式定义过滤工具注册表。
 *
 * 这是模式模块与工具模块的唯一桥接点。
 * 返回一个新的 ToolRegistry，不修改原始实例。
 */
export function applyToolFilter(mode: ModeDefinition, tools: ToolRegistry): ToolRegistry {
  if (!mode.tools) return tools;
  if (mode.tools.include) {
    return tools.createSubset(mode.tools.include);
  }
  if (mode.tools.exclude) {
    return tools.createFiltered(mode.tools.exclude);
  }
  return tools;
}
