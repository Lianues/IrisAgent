/**
 * @iris/extension-utils
 *
 * Iris extension 系统的内部共享工具包。
 * 供 core (src/extension/) 和 terminal (terminal/src/) 共享使用，
 * 避免重复实现。
 *
 * 设计约束：
 * - 零外部 npm 依赖，仅使用 Node.js 内置模块
 * - 使用松散接口 (*Like) 避免依赖 core 严格类型
 */

// ---- types ----
export type {
  ExtensionManifestLike,
  ExtensionPluginContributionLike,
  ExtensionPlatformContributionLike,
  ExtensionDistributionContributionLike,
  RemoteIndexLike,
} from './types.js';
export { DISABLED_MARKER_FILE } from './types.js';

// ---- paths ----
export {
  normalizeText,
  normalizeRelativeFilePath,
  normalizeRequestedExtensionPath,
  resolveSafeRelativePath,
  encodeRepoPathForUrl,
} from './paths.js';

// ---- manifest ----
export {
  MANIFEST_FILE,
  parseExtensionManifest,
  readManifestFromDir,
} from './manifest.js';

// ---- fs-utils ----
export {
  isDirectory,
  ensureDirectory,
  createTempInstallDir,
  cleanupTempInstallDir,
  collectRelativeFilesFromDir,
} from './fs-utils.js';

// ---- runtime-paths ----
export {
  resolveRuntimeDataDir,
  resolveRuntimeConfigDir,
  getInstalledExtensionsDir,
} from './runtime-paths.js';

// ---- remote ----
export type { RemoteExtensionOptions } from './remote.js';
export {
  DEFAULT_REMOTE_EXTENSION_INDEX_URL,
  DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL,
  DEFAULT_REMOTE_EXTENSIONS_SUBDIR,
  DEFAULT_REMOTE_EXTENSION_REQUEST_TIMEOUT_MS,
  getRemoteExtensionRequestTimeoutMs,
  getRemoteExtensionIndexUrl,
  getRemoteRawBaseUrl,
  getRemoteExtensionsSubdir,
  fetchWithTimeout,
  fetchBuffer,
  fetchJson,
  fetchRemoteIndex,
  buildRemoteExtensionPath,
  getRemoteDistributionFiles,
  buildRemoteExtensionFileUrl,
  fetchRemoteManifest,
} from './remote.js';

// ---- runtime-analysis ----
export type {
  RuntimeEntryGroup,
  RuntimeEntryGroupAnalysis,
} from './runtime-analysis.js';
export {
  SOURCE_FILE_EXTENSIONS,
  RUNTIME_FILE_EXTENSIONS,
  collectRuntimeEntryGroups,
  analyzeRuntimeEntries,
  describeRuntimeIssues,
} from './runtime-analysis.js';
