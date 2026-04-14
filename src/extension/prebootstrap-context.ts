/**
 * PreBootstrap 插件上下文实现
 */

import type { AppConfig } from '../config/types';
import type { BootstrapExtensionRegistry, LLMProviderFactory, StorageFactory } from '../bootstrap/extensions';
import type { PlatformFactory } from '../core/platform-registry';
import type { PreBootstrapContext, PluginLogger } from 'irises-extension-sdk';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';

/** @internal 结构上满足 SDK PreBootstrapContext，通过 as 断言使用 */
export class PreBootstrapContextImpl {
  constructor(
    private pluginName: string,
    private appConfig: AppConfig,
    private extensions: BootstrapExtensionRegistry,
    private pluginConfig?: Record<string, unknown>,
    private configDir?: string,
  ) {}

  getConfig(): Readonly<AppConfig> {
    return this.appConfig;
  }

  mutateConfig(mutator: (config: AppConfig) => void): void {
    mutator(this.appConfig);
  }

  registerLLMProvider(name: string, factory: LLMProviderFactory): void {
    this.extensions.llmProviders.register(name, factory);
  }

  registerStorageProvider(type: string, factory: StorageFactory): void {
    this.extensions.storageProviders.register(type, factory);
  }

  /** @deprecated Memory 已迁移为独立扩展插件，此方法保留为空操作以兼容旧插件 */
  registerMemoryProvider(_type: string, _factory: unknown): void {
    // no-op: memory 现在由 extensions/memory 插件自行管理
  }

  /** @deprecated OCR 功能已迁移至 multimodal 扩展，此方法保留为空操作以兼容旧插件 */
  registerOCRProvider(_name: string, _factory: unknown): void {
    // no-op: OCR 现在由 multimodal 扩展通过 onProcessUserMedia hook 实现
  }

  registerPlatform(name: string, factory: PlatformFactory): void {
    this.extensions.platforms.register(name, factory);
  }

  getExtensions(): BootstrapExtensionRegistry {
    return this.extensions;
  }

  getLogger(tag?: string): PluginLogger {
    const prefix = tag
      ? `Plugin:${this.pluginName}:PreBootstrap:${tag}`
      : `Plugin:${this.pluginName}:PreBootstrap`;
    return createLogger(prefix);
  }

  getPluginConfig<T = Record<string, unknown>>(): T | undefined {
    return this.pluginConfig as T | undefined;
  }

  // ---- 配置文件管理 ----

  getConfigDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    return this.configDir;
  }

  getDataDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    const dataDir = path.dirname(this.configDir);
    const dir = path.join(dataDir, 'extension-data', this.pluginName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  ensureConfigFile(filename: string, content: string): boolean {
    if (!this.configDir) throw new Error('configDir 未设置');
    const filePath = path.join(this.configDir, filename);
    if (fs.existsSync(filePath)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  readConfigSection(section: string): Record<string, unknown> | undefined {
    if (!this.configDir) return undefined;
    const filePath = path.join(this.configDir, `${section}.yaml`);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (parseYAML(raw) as Record<string, unknown>) ?? undefined;
  }
}
