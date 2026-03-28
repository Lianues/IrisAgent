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
  definePlatformFactory,
  getPlatformConfig,
  PlatformAdapter,
  splitText,
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
  PlatformFactoryHelperOptions,
  ToolAttachment,
} from './platform';

export type {
  Content,
  FunctionCallPart,
  FunctionResponsePart,
  InlineDataPart,
  Part,
  Role,
  TextPart,
  TokensDetail,
  UsageMetadata,
} from './message';

export type {
  LLMGenerationConfig,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from './llm';

export type {
  ModeDefinition,
  ToolFilter,
} from './mode';

export type {
  FunctionDeclaration,
  ToolDefinition,
  ToolHandler,
  ToolInvocation,
  ToolParallelPolicy,
  ToolParallelResolver,
  ToolStatus,
} from './tool';

export {
  createExtensionLogger,
} from './logger';

export type {
  ExtensionLogger,
} from './logger';

export {
  createPluginLogger,
  definePlugin,
} from './plugin';

export type {
  BootstrapExtensionRegistryLike,
  InlinePluginEntry,
  IrisAPI,
  IrisPlugin,
  LLMProviderFactory,
  LLMRouterLike,
  MemoryFactory,
  ModeRegistryLike,
  NamedFactoryRegistryLike,
  OCRFactory,
  PatchDisposer,
  PatchMethod,
  PatchPrototype,
  PlatformFactory,
  PluginContext,
  PluginEntry,
  PluginEventBusLike,
  PluginHook,
  PluginLogger,
  PluginManagerLike,
  PreBootstrapContext,
  PromptAssemblerLike,
  StorageFactory,
  ToolExecInterception,
  ToolRegistryLike,
  ToolWrapper,
} from './plugin';

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
