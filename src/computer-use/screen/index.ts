/**
 * Screen 适配器注册中心
 *
 * 根据当前操作系统自动选择对应的平台实现。
 * 新增平台只需在下方 adapters 数组中添加即可。
 */

import type { ScreenAdapter } from './adapter';
import { WindowsScreenAdapter } from './windows';

/** 已注册的平台适配器（按优先级排序） */
const adapters: ScreenAdapter[] = [
  new WindowsScreenAdapter(),
  // 后续添加：
  // new MacOSScreenAdapter(),
  // new LinuxScreenAdapter(),
];

/** 获取当前平台的 ScreenAdapter，不支持则返回 undefined */
export function getScreenAdapter(): ScreenAdapter | undefined {
  return adapters.find(a => a.isSupported());
}

export type { ScreenAdapter } from './adapter';
