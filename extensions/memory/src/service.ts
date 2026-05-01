import * as path from 'path';
import type { IrisAPI } from 'irises-extension-sdk';
import { SqliteMemory } from './sqlite/index.js';
import type { MemoryAddInput, MemoryEntry, MemoryUpdateInput } from './types.js';
import type { DreamResult } from './consolidation.js';
import { forceRunConsolidation } from './consolidation.js';
import { findAndFormatRelevantMemories } from './retrieval.js';
import { runMemoryExtraction } from './extract.js';
import type { MemoryPluginConfig, MemorySpaceConfig } from './config.js';
import { resolveSpaceConfig } from './config.js';

export const MEMORY_SPACES_SERVICE_ID = 'memory.spaces';

export interface MemorySpaceInfo {
  id: string;
  enabled: boolean;
  dbPath: string;
  count?: number;
}

export interface MemorySpaceBuildContextInput {
  userText: string;
  maxBytes?: number;
  modelName?: string;
}

export interface MemorySpaceBuildContextResult {
  text: string;
  bytes: number;
  ids: number[];
  userIds: number[];
}

export interface MemorySpaceExtractInput {
  sessionId: string;
  modelName?: string;
}

export interface MemorySpaceExtractResult {
  ok: boolean;
  savedCount: number;
  message: string;
}

export interface MemorySpaceHandle {
  readonly id: string;
  readonly dbPath: string;
  search(query: string, options?: { type?: string; limit?: number }): Promise<MemoryEntry[]>;
  add(input: MemoryAddInput): Promise<number>;
  update(input: MemoryUpdateInput): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  list(type?: string, limit?: number): Promise<MemoryEntry[]>;
  count(): Promise<number>;
  buildContext(input: MemorySpaceBuildContextInput): Promise<MemorySpaceBuildContextResult | undefined>;
  extractFromSession(input: MemorySpaceExtractInput): Promise<MemorySpaceExtractResult>;
  dream(): Promise<DreamResult>;
}

export interface MemorySpacesService {
  getSpace(id: string): MemorySpaceHandle | undefined;
  getOrCreateSpace(id: string): MemorySpaceHandle;
  listSpaces(): MemorySpaceInfo[];
  updateConfig(config: MemoryPluginConfig): void;
}

interface MemorySpacesServiceOptions {
  api: IrisAPI;
  dataDir: string;
  config: MemoryPluginConfig;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

export function createMemorySpacesService(options: MemorySpacesServiceOptions): MemorySpacesService {
  return new MemorySpacesServiceImpl(options);
}

class MemorySpacesServiceImpl implements MemorySpacesService {
  private config: MemoryPluginConfig;
  private spaces = new Map<string, MemorySpaceHandleImpl>();

  constructor(private options: MemorySpacesServiceOptions) {
    this.config = options.config;
  }

  updateConfig(config: MemoryPluginConfig): void {
    this.config = config;
    for (const [id, handle] of this.spaces) {
      const spaceConfig = this.resolveConfigForSpace(id);
      handle.updateConfig(spaceConfig, this.config, resolveSpaceDbPath(this.options.dataDir, id, spaceConfig));
    }
  }

  getSpace(id: string): MemorySpaceHandle | undefined {
    const safeId = sanitizeSpaceId(id);
    const configured = this.config.spaces[safeId];
    if (!configured || configured.enabled === false) return undefined;
    return this.getOrCreateSpace(safeId);
  }

  getOrCreateSpace(id: string): MemorySpaceHandle {
    const safeId = sanitizeSpaceId(id);
    const existing = this.spaces.get(safeId);
    if (existing) return existing;

    const config = this.resolveConfigForSpace(safeId);
    const dbPath = resolveSpaceDbPath(this.options.dataDir, safeId, config);
    const handle = new MemorySpaceHandleImpl({
      id: safeId,
      dbPath,
      api: this.options.api,
      config,
      baseConfig: this.config,
      logger: this.options.logger,
    });
    this.spaces.set(safeId, handle);
    return handle;
  }

  listSpaces(): MemorySpaceInfo[] {
    const ids = new Set<string>([
      ...Object.keys(this.config.spaces),
      ...this.spaces.keys(),
    ]);
    return Array.from(ids).sort().map((id) => {
      const config = this.resolveConfigForSpace(id);
      return {
        id,
        enabled: config.enabled,
        dbPath: resolveSpaceDbPath(this.options.dataDir, id, config),
      };
    });
  }

  private resolveConfigForSpace(id: string): MemorySpaceConfig {
    return this.config.spaces[id] ?? resolveSpaceConfig(undefined, this.config);
  }
}

interface MemorySpaceHandleOptions {
  id: string;
  dbPath: string;
  api: IrisAPI;
  config: MemorySpaceConfig;
  baseConfig: MemoryPluginConfig;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

class MemorySpaceHandleImpl implements MemorySpaceHandle {
  private provider?: SqliteMemory;
  private config: MemorySpaceConfig;
  private baseConfig: MemoryPluginConfig;

  constructor(private options: MemorySpaceHandleOptions) {
    this.config = options.config;
    this.baseConfig = options.baseConfig;
  }

  get id(): string { return this.options.id; }
  get dbPath(): string { return this.options.dbPath; }

  updateConfig(config: MemorySpaceConfig, baseConfig: MemoryPluginConfig, dbPath: string): void {
    this.config = config;
    this.baseConfig = baseConfig;
    if (this.options.dbPath !== dbPath) {
      this.options.dbPath = dbPath;
      this.provider = undefined;
    }
  }

  async search(query: string, options: { type?: string; limit?: number } = {}): Promise<MemoryEntry[]> {
    this.assertEnabled();
    const results = await this.getProvider().search(query, options.limit ?? 10);
    return options.type ? results.filter((item) => item.type === options.type) : results;
  }

  async add(input: MemoryAddInput): Promise<number> {
    this.assertEnabled();
    return await this.getProvider().add(input);
  }

  async update(input: MemoryUpdateInput): Promise<boolean> {
    this.assertEnabled();
    return await this.getProvider().update(input);
  }

  async delete(id: number): Promise<boolean> {
    this.assertEnabled();
    return await this.getProvider().delete(id);
  }

  async list(type?: string, limit?: number): Promise<MemoryEntry[]> {
    this.assertEnabled();
    return await this.getProvider().list(type, limit);
  }

  async count(): Promise<number> {
    this.assertEnabled();
    return await this.getProvider().count();
  }

  async buildContext(input: MemorySpaceBuildContextInput): Promise<MemorySpaceBuildContextResult | undefined> {
    this.assertEnabled();
    const userText = input.userText.trim();
    if (!userText) return undefined;

    const result = await findAndFormatRelevantMemories({
      router: this.options.api.router,
      provider: this.getProvider(),
      userText,
      maxBytes: input.maxBytes ?? this.config.maxContextBytes,
      modelName: input.modelName ?? this.config.model ?? this.baseConfig.model,
      surfaced: new Set<number>(),
      smallSetThreshold: this.config.smallSetThreshold,
      logger: this.options.logger,
    });

    if (!result) return undefined;
    return {
      text: result.text,
      bytes: result.bytes,
      ids: result.ids,
      userIds: result.userIds,
    };
  }

  async extractFromSession(input: MemorySpaceExtractInput): Promise<MemorySpaceExtractResult> {
    this.assertEnabled();
    const sessionId = input.sessionId.trim();
    if (!sessionId) return { ok: false, savedCount: 0, message: 'sessionId 不能为空' };

    const savedCount = await runMemoryExtraction({
      api: this.options.api,
      provider: this.getProvider(),
      sessionId,
      modelName: input.modelName ?? this.config.model ?? this.baseConfig.model,
      logger: this.options.logger,
    });

    return {
      ok: true,
      savedCount,
      message: savedCount > 0
        ? `已从会话 ${sessionId} 提取 ${savedCount} 条记忆。`
        : `会话 ${sessionId} 没有提取到新的持久记忆。`,
    };
  }

  async dream(): Promise<DreamResult> {
    this.assertEnabled();
    return await forceRunConsolidation({
      api: this.options.api,
      provider: this.getProvider(),
      config: this.toPluginConfig(),
      logger: this.options.logger,
    });
  }

  private getProvider(): SqliteMemory {
    if (!this.provider) {
      this.provider = new SqliteMemory(this.options.dbPath, {
        info: (...args: unknown[]) => this.options.logger.info(`[space:${this.id}]`, ...args),
        warn: (...args: unknown[]) => this.options.logger.warn(`[space:${this.id}]`, ...args),
      });
    }
    return this.provider;
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new Error(`记忆空间 "${this.id}" 未启用`);
    }
  }

  private toPluginConfig(): MemoryPluginConfig {
    return {
      ...this.baseConfig,
      model: this.config.model ?? this.baseConfig.model,
      maxContextBytes: this.config.maxContextBytes,
      smallSetThreshold: this.config.smallSetThreshold,
      consolidation: this.config.consolidation,
    };
  }
}

function resolveSpaceDbPath(dataDir: string, id: string, config: MemorySpaceConfig): string {
  const configured = config.dbPath?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(dataDir, configured);
  }
  return path.join(dataDir, 'spaces', id, 'memory.db');
}

function sanitizeSpaceId(id: string): string {
  const normalized = id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`无效 memory space id: ${id}`);
  }
  return normalized;
}
