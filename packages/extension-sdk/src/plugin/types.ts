import type { IrisPlatformFactoryContextLike } from '../platform.js';

export type PatchDisposer = () => void;
export type PatchMethod = (...args: any[]) => PatchDisposer;
export type PatchPrototype = (...args: any[]) => PatchDisposer;

export interface NamedFactoryRegistryLike<TFactory> {
  register(name: string, factory: TFactory): void;
  unregister?(name: string): boolean;
  get?(name: string): TFactory | undefined;
  has?(name: string): boolean;
  list?(): string[];
}

export type LLMProviderFactory = (config: Record<string, unknown>) => unknown;
export type StorageFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
export type MemoryFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
/** @deprecated OCR 功能已迁移至 multimodal 扩展 */
export type OCRFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
export type PlatformFactory = (context: IrisPlatformFactoryContextLike) => Promise<unknown> | unknown;

export interface BootstrapExtensionRegistryLike {
  llmProviders: NamedFactoryRegistryLike<LLMProviderFactory>;
  storageProviders: NamedFactoryRegistryLike<StorageFactory>;
  /** @deprecated Memory 已迁移为独立扩展插件 */
  memoryProviders?: NamedFactoryRegistryLike<MemoryFactory>;
  /** @deprecated OCR 功能已迁移至 multimodal 扩展 */
  ocrProviders: NamedFactoryRegistryLike<OCRFactory>;
  platforms: NamedFactoryRegistryLike<PlatformFactory>;
}
