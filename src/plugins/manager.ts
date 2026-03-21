/**
 * 插件管理器
 *
 * 负责插件的发现、加载、激活和停用。
 * 支持本地目录插件（~/.iris/plugins/）和 npm 包插件（iris-plugin-*）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import { createLogger } from '../logger';
import { dataDir } from '../paths';
import type { ToolRegistry } from '../tools/registry';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { AppConfig } from '../config/types';
import type { IrisPlugin, PluginEntry, PluginHook, PluginInfo, LoadedPlugin, IrisAPI } from './types';
import { PluginContextImpl } from './context';

const logger = createLogger('PluginManager');

/** 插件目录 */
export const pluginsDir = path.join(dataDir, 'plugins');

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();

  /**
   * 加载所有配置中启用的插件。
   * 在 bootstrap 中调用，位于 ToolRegistry/ModeRegistry/PromptAssembler 创建之后、Backend 创建之前。
   */
  async loadAll(
    entries: PluginEntry[],
    internals: { tools: ToolRegistry; modes: ModeRegistry; prompt: PromptAssembler },
    appConfig: AppConfig,
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.enabled === false) {
        logger.info(`插件 "${entry.name}" 已禁用，跳过`);
        continue;
      }

      try {
        await this.load(entry, internals, appConfig);
      } catch (err) {
        logger.error(`插件 "${entry.name}" 加载失败:`, err);
      }
    }

    const loaded = this.plugins.size;
    if (loaded > 0) {
      logger.info(`已加载 ${loaded} 个插件`);
    }
  }

  /** 加载并激活单个插件 */
  async load(
    entry: PluginEntry,
    internals: { tools: ToolRegistry; modes: ModeRegistry; prompt: PromptAssembler },
    appConfig: AppConfig,
  ): Promise<void> {
    if (this.plugins.has(entry.name)) {
      logger.warn(`插件 "${entry.name}" 已加载，跳过重复注册`);
      return;
    }

    const plugin = await this.resolvePlugin(entry);
    const pluginConfig = this.loadPluginConfig(entry);

    const context = new PluginContextImpl(
      entry.name,
      internals.tools,
      internals.modes,
      appConfig,
      internals.prompt,
      pluginConfig,
    );

    await plugin.activate(context);

    this.plugins.set(entry.name, {
      entry,
      plugin,
      hooks: context.getHooks(),
      readyCallbacks: context.getReadyCallbacks(),
    });

    logger.info(`插件 "${plugin.name}@${plugin.version}" 已激活`);
  }

  /**
   * 通知所有插件 Backend 已创建完成。
   * 依次调用各插件通过 ctx.onReady() 注册的回调，传递完整的内部 API。
   */
  async notifyReady(api: IrisAPI): Promise<void> {
    for (const [name, loaded] of this.plugins) {
      for (const callback of loaded.readyCallbacks) {
        try {
          await callback(api);
        } catch (err) {
          logger.error(`插件 "${name}" onReady 回调执行失败:`, err);
        }
      }
    }
  }

  /** 停用所有插件并清空 */
  async unloadAll(): Promise<void> {
    for (const [name, loaded] of this.plugins) {
      try {
        await loaded.plugin.deactivate?.();
        logger.info(`插件 "${name}" 已停用`);
      } catch (err) {
        logger.error(`插件 "${name}" 停用失败:`, err);
      }
    }
    this.plugins.clear();
  }

  /** 获取所有已加载插件注册的钩子 */
  getHooks(): PluginHook[] {
    const hooks: PluginHook[] = [];
    for (const loaded of this.plugins.values()) {
      hooks.push(...loaded.hooks);
    }
    return hooks;
  }

  /** 列出已加载的插件信息 */
  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(({ entry, plugin, hooks }) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: true,
      type: entry.type ?? 'local',
      hookCount: hooks.length,
    }));
  }

  /** 已加载插件数量 */
  get size(): number {
    return this.plugins.size;
  }

  // ============ 私有方法 ============

  private async resolvePlugin(entry: PluginEntry): Promise<IrisPlugin> {
    const type = entry.type ?? 'local';
    if (type === 'npm') return this.loadNpmPlugin(entry.name);
    return this.loadLocalPlugin(entry.name);
  }

  private async loadLocalPlugin(name: string): Promise<IrisPlugin> {
    const pluginDir = path.join(pluginsDir, name);
    if (!fs.existsSync(pluginDir)) {
      throw new Error(`插件目录不存在: ${pluginDir}`);
    }

    const candidates = ['index.ts', 'index.js', 'index.mjs'];
    let entryFile: string | undefined;
    for (const candidate of candidates) {
      const filePath = path.join(pluginDir, candidate);
      if (fs.existsSync(filePath)) {
        entryFile = filePath;
        break;
      }
    }

    if (!entryFile) {
      throw new Error(`插件 "${name}" 缺少入口文件（index.ts 或 index.js）: ${pluginDir}`);
    }

    const mod = await import(entryFile);
    const plugin = mod.default ?? mod;
    this.validatePlugin(plugin, name);
    return plugin as IrisPlugin;
  }

  private async loadNpmPlugin(name: string): Promise<IrisPlugin> {
    const packageName = `iris-plugin-${name}`;
    try {
      const mod = await import(packageName);
      const plugin = mod.default ?? mod;
      this.validatePlugin(plugin, name);
      return plugin as IrisPlugin;
    } catch (err) {
      throw new Error(`npm 插件 "${packageName}" 加载失败。请确认已安装该包。原始错误: ${err}`);
    }
  }

  private validatePlugin(plugin: unknown, name: string): void {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`插件 "${name}" 导出格式无效：应导出一个对象`);
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name) throw new Error(`插件 "${name}" 缺少 name 字段`);
    if (typeof p.version !== 'string' || !p.version) throw new Error(`插件 "${name}" 缺少 version 字段`);
    if (typeof p.activate !== 'function') throw new Error(`插件 "${name}" 缺少 activate 方法`);
  }

  private loadPluginConfig(entry: PluginEntry): Record<string, unknown> | undefined {
    let baseConfig: Record<string, unknown> | undefined;

    const configPath = path.join(pluginsDir, entry.name, 'config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = parseYAML(raw);
        if (parsed && typeof parsed === 'object') {
          baseConfig = parsed as Record<string, unknown>;
        }
      } catch {
        logger.warn(`插件 "${entry.name}" 的 config.yaml 解析失败`);
      }
    }

    if (entry.config) {
      return { ...(baseConfig ?? {}), ...entry.config };
    }
    return baseConfig;
  }
}
