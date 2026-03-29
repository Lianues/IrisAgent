/**
 * 共享松散接口
 *
 * 使用 *Like 后缀表示这些接口只要求最少字段，
 * core 的严格类型 (ExtensionManifest 等) 天然兼容这些松散签名。
 */

export interface ExtensionPluginContributionLike {
  entry?: string;
  configFile?: string;
}

export interface ExtensionPlatformContributionLike {
  name?: string;
  entry?: string;
}

export interface ExtensionDistributionContributionLike {
  files?: string[];
}

export interface ExtensionManifestLike {
  name?: string;
  version?: string;
  description?: string;
  entry?: string;
  plugin?: ExtensionPluginContributionLike;
  platforms?: ExtensionPlatformContributionLike[];
  distribution?: ExtensionDistributionContributionLike;
}

export interface RemoteIndexLike {
  extensions?: string[];
}

export const DISABLED_MARKER_FILE = '.disabled';
