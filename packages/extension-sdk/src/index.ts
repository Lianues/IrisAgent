export type {
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPluginContribution,
  ExtensionSource,
  InstalledExtensionResult,
  ResolvedLocalPlugin,
  ExtensionInstallFallbackReason,
} from './manifest';

export {
  PlatformAdapter,
  splitText,
  getPlatformConfig,
} from './platform';

export type {
  DocumentInput,
  ImageInput,
  IrisBackendLike,
  IrisModeInfoLike,
  IrisModelInfoLike,
  IrisPlatformFactoryContextLike,
  IrisSessionMetaLike,
  IrisSkillInfoLike,
  IrisToolInvocationLike,
  ToolAttachment,
} from './platform';

export {
  createExtensionLogger,
} from './logger';

export type {
  ExtensionLogger,
} from './logger';

export {
  resolveDefaultDataDir,
} from './runtime-paths';

export {
  PairingGuard,
  PairingStore,
  generatePairingCode,
} from './pairing';

export type {
  AllowedUser,
  PairingAdmin,
  PairingCheckResult,
  PairingConfig,
  PendingPairing,
} from './pairing';
