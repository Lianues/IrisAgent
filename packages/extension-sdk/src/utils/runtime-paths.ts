/**
 * 数据目录解析
 *
 * 归集 core paths.ts / terminal runtime-paths.ts
 * 中重复的数据目录解析逻辑。
 */

import { resolveDefaultDataDir } from '../runtime-paths.js';
import * as path from 'node:path';

/** 解析 Iris 数据根目录（~/.iris/ 或 IRIS_DATA_DIR 覆盖） */
export function resolveRuntimeDataDir(): string {
  return resolveDefaultDataDir();
}

/** 解析 Iris 配置文件目录（dataDir/configs/） */
export function resolveRuntimeConfigDir(): string {
  return path.join(resolveRuntimeDataDir(), 'configs');
}

/** 解析已安装 extension 目录（dataDir/extensions/） */
export function getInstalledExtensionsDir(): string {
  return path.join(resolveRuntimeDataDir(), 'extensions');
}
