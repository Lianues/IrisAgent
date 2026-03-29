/**
 * 运行时入口分析
 *
 * 归集 core dependencies.ts / terminal runtime.ts 中重复的
 * 运行时入口收集、校验、问题描述逻辑。
 */

import * as path from 'node:path';
import { normalizeText } from './paths.js';
import type { ExtensionManifestLike } from './types.js';

export const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
export const RUNTIME_FILE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);

export interface RuntimeEntryGroup {
  label: string;
  alternatives: string[];
}

export interface RuntimeEntryGroupAnalysis {
  label: string;
  alternatives: string[];
  existingAlternatives: string[];
  runnableAlternatives: string[];
  sourceAlternatives: string[];
  needsBuild: boolean;
}

/**
 * 根据 manifest 声明收集运行时入口分组。
 * 每个分组包含一组候选入口文件路径。
 */
export function collectRuntimeEntryGroups(manifest: ExtensionManifestLike): RuntimeEntryGroup[] {
  const groups: RuntimeEntryGroup[] = [];

  const pluginEntry = normalizeText(manifest.plugin?.entry) ?? normalizeText(manifest.entry);
  const hasPlatforms = Array.isArray(manifest.platforms) && manifest.platforms.length > 0;

  if (pluginEntry) {
    groups.push({ label: 'plugin', alternatives: [pluginEntry] });
  } else if (!hasPlatforms) {
    groups.push({
      label: 'plugin',
      alternatives: ['index.mjs', 'index.js', 'index.cjs', 'index.ts'],
    });
  }

  for (const platform of manifest.platforms ?? []) {
    const name = normalizeText(platform?.name);
    const entry = normalizeText(platform?.entry);
    if (!name || !entry) continue;
    groups.push({ label: `platform:${name}`, alternatives: [entry] });
  }

  return groups;
}

/**
 * 分析运行时入口的可用性。
 *
 * @param availableFiles 可用文件的相对路径列表（POSIX 风格）
 * @param manifest extension manifest
 */
export function analyzeRuntimeEntries(availableFiles: string[], manifest: ExtensionManifestLike): RuntimeEntryGroupAnalysis[] {
  const normalizedFiles = new Set(availableFiles.map((file) => file.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')));

  return collectRuntimeEntryGroups(manifest).map((group) => {
    const existingAlternatives = group.alternatives.filter((relativePath) =>
      normalizedFiles.has(relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')),
    );

    const runnableAlternatives = existingAlternatives.filter((relativePath) =>
      RUNTIME_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()),
    );

    const sourceAlternatives = existingAlternatives.filter((relativePath) => {
      const ext = path.extname(relativePath).toLowerCase();
      return SOURCE_FILE_EXTENSIONS.has(ext) || /(^|[\\/])src([\\/]|$)/.test(relativePath);
    });

    const needsBuild = runnableAlternatives.length === 0 || sourceAlternatives.length > 0;

    return {
      label: group.label,
      alternatives: group.alternatives,
      existingAlternatives,
      runnableAlternatives,
      sourceAlternatives,
      needsBuild,
    };
  });
}

/** 将运行时分析问题输出为可读描述 */
export function describeRuntimeIssues(analyses: RuntimeEntryGroupAnalysis[]): string {
  return analyses
    .filter((item) => item.needsBuild)
    .map((item) => {
      if (item.sourceAlternatives.length > 0) {
        return `${item.label} 使用了源码入口: ${item.sourceAlternatives.join(', ')}`;
      }
      if (item.existingAlternatives.length > 0) {
        return `${item.label} 缺少可运行入口，当前存在: ${item.existingAlternatives.join(', ')}`;
      }
      return `${item.label} 缺少入口文件，期望其一: ${item.alternatives.join(', ')}`;
    })
    .join('；');
}
