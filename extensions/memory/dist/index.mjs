// src/index.ts
import * as path2 from "path";
// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/sqlite/index.ts
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

// src/base.ts
class MemoryProvider {
  async buildContext(userText, limit = 5) {
    if (!userText)
      return;
    const memories = await this.search(userText, limit);
    if (memories.length === 0)
      return;
    const lines = memories.map((m) => `- [${m.category}] ${m.content}`).join(`
`);
    return `

## 长期记忆
以下是与当前对话可能相关的记忆：
${lines}`;
  }
}

// src/sqlite/index.ts
class SqliteMemory extends MemoryProvider {
  logger;
  db;
  constructor(dbPath, logger) {
    super();
    this.logger = logger;
    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'note',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content=memories,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
    this.logger?.info(`记忆存储已初始化: ${dbPath}`);
  }
  async add(content, category = "note") {
    const result = this.db.prepare("INSERT INTO memories (content, category) VALUES (?, ?)").run(content, category);
    this.logger?.info(`添加记忆 #${result.lastInsertRowid} [${category}]`);
    return result.lastInsertRowid;
  }
  async search(query, limit = 5) {
    const tokens = query.replace(/["*(){}[\]^~:+\-]/g, " ").split(/\s+/).filter((w) => w.length > 0 && !["AND", "OR", "NOT", "NEAR"].includes(w.toUpperCase())).slice(0, 10);
    const sanitized = tokens.map((w) => `"${w}"`).join(" OR ");
    if (!sanitized)
      return [];
    const rows = this.db.prepare(`
        SELECT m.id, m.content, m.category, m.created_at, m.updated_at
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, limit);
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  async list(category, limit = 20) {
    let rows;
    if (category) {
      rows = this.db.prepare("SELECT id, content, category, created_at, updated_at FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?").all(category, limit);
    } else {
      rows = this.db.prepare("SELECT id, content, category, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit);
    }
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  async delete(id) {
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.logger?.info(`删除记忆 #${id}`);
      return true;
    }
    return false;
  }
  async clear() {
    this.db.exec("DELETE FROM memories");
    this.logger?.info("已清空所有记忆");
  }
}

// src/tools.ts
var MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_add", "memory_delete"]);
function createMemoryTools(provider) {
  const memorySearch = {
    parallel: true,
    declaration: {
      name: "memory_search",
      description: "搜索长期记忆中的相关信息。当需要回忆用户偏好、历史事实或之前保存的信息时使用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          limit: { type: "number", description: "返回数量，默认 5" }
        },
        required: ["query"]
      }
    },
    handler: async (args) => {
      const query = args.query;
      const limit = args.limit || 5;
      const results = await provider.search(query, limit);
      if (results.length === 0) {
        return { message: "未找到相关记忆", results: [] };
      }
      return {
        message: `找到 ${results.length} 条相关记忆`,
        results: results.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.category
        }))
      };
    }
  };
  const memoryAdd = {
    declaration: {
      name: "memory_add",
      description: "将重要信息保存到长期记忆。用于记住用户偏好、重要事实、关键决策等需要跨会话保留的信息。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "记忆内容" },
          category: {
            type: "string",
            description: "分类：user / fact / preference / note",
            enum: ["user", "fact", "preference", "note"]
          }
        },
        required: ["content"]
      }
    },
    handler: async (args) => {
      const content = args.content;
      const category = args.category || "note";
      const id = await provider.add(content, category);
      return { message: `记忆已保存`, id, content, category };
    }
  };
  const memoryDelete = {
    declaration: {
      name: "memory_delete",
      description: "删除一条不再需要的记忆。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "记忆 ID" }
        },
        required: ["id"]
      }
    },
    handler: async (args) => {
      const id = args.id;
      const success = await provider.delete(id);
      return success ? { message: `记忆 #${id} 已删除` } : { message: `记忆 #${id} 不存在` };
    }
  };
  return [memorySearch, memoryAdd, memoryDelete];
}

// src/config-template.ts
var DEFAULT_CONFIG_TEMPLATE = `# 记忆插件配置
#
# 启用后，LLM 可通过 memory_search / memory_add / memory_delete 工具
# 读写长期记忆，实现跨会话的信息持久化。
#
# 存储后端：SQLite + FTS5 全文检索
# 数据库文件默认存放在数据目录下的 memory.db

# 是否启用记忆
enabled: false

# 数据库路径（相对于数据目录，或绝对路径）
# dbPath: ./memory.db
`;

// src/index.ts
var logger = createPluginLogger("memory");
var activeProvider;
var cachedApi;
var lastUserText;
var memoryInjectedThisRound = false;
var autoRecallEnabled = true;
var src_default = definePlugin({
  name: "memory",
  version: "0.1.0",
  description: "长期记忆系统 — SQLite + FTS5 全文检索",
  activate(ctx) {
    const created = ctx.ensureConfigFile("memory.yaml", DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger.info("已在配置目录中安装 memory.yaml 默认模板");
    }
    const rawConfig = ctx.readConfigSection("memory");
    const config = resolveConfig(rawConfig, ctx.getPluginConfig());
    if (!config.enabled) {
      logger.info("记忆系统未启用");
      return;
    }
    ctx.onReady(async (api) => {
      cachedApi = api;
      const dbPath = config.dbPath ? path2.resolve(ctx.getConfigDir(), config.dbPath) : path2.join(api.dataDir ?? ctx.getConfigDir(), "memory.db");
      activeProvider = new SqliteMemory(dbPath, logger);
      const tools = createMemoryTools(activeProvider);
      api.tools.registerAll(tools);
      logger.info(`记忆工具已注册（${tools.length} 个）`);
      api.memory = activeProvider;
      const hasSubAgents = !!api.tools.get("sub_agent");
      autoRecallEnabled = !hasSubAgents;
      if (hasSubAgents) {
        ctx.addSystemPromptPart({
          text: `
- 需要检索长期记忆时，使用 recall 子代理
- memory_add 和 memory_delete 请直接使用，不要委派`
        });
        logger.info("autoRecall 已禁用（存在子代理，由 recall 类型处理检索）");
      } else {
        logger.info("autoRecall 已启用（无子代理，插件自动注入记忆上下文）");
      }
    });
    ctx.addHook({
      name: "memory:capture-user-text",
      priority: 200,
      onBeforeChat({ text }) {
        lastUserText = text;
        memoryInjectedThisRound = false;
        return;
      }
    });
    ctx.addHook({
      name: "memory:auto-recall",
      priority: 100,
      async onBeforeLLMCall({ request }) {
        if (!autoRecallEnabled || !activeProvider || !lastUserText || memoryInjectedThisRound) {
          return;
        }
        memoryInjectedThisRound = true;
        try {
          const context = await activeProvider.buildContext(lastUserText);
          if (!context)
            return;
          const sysInst = request.systemInstruction;
          const existingParts = sysInst?.parts ? [...sysInst.parts] : [];
          existingParts.push({ text: context });
          return {
            request: {
              ...request,
              systemInstruction: { parts: existingParts }
            }
          };
        } catch (err) {
          logger.warn("查询记忆失败:", err);
          return;
        }
      }
    });
    ctx.addHook({
      name: "memory:config-reload",
      async onConfigReload() {
        if (!cachedApi)
          return;
        const newRaw = ctx.readConfigSection("memory");
        const newConfig = resolveConfig(newRaw, ctx.getPluginConfig());
        if (!newConfig.enabled) {
          for (const name of MEMORY_TOOL_NAMES) {
            cachedApi.tools.unregister?.(name);
          }
          activeProvider = undefined;
          cachedApi.memory = undefined;
          logger.info("记忆系统已禁用（配置重载）");
          return;
        }
        const dbPath = newConfig.dbPath ? path2.resolve(ctx.getConfigDir(), newConfig.dbPath) : path2.join(cachedApi.dataDir ?? ctx.getConfigDir(), "memory.db");
        activeProvider = new SqliteMemory(dbPath, logger);
        cachedApi.memory = activeProvider;
        for (const name of MEMORY_TOOL_NAMES) {
          cachedApi.tools.unregister?.(name);
        }
        cachedApi.tools.registerAll(createMemoryTools(activeProvider));
        logger.info("记忆系统已重载");
      }
    });
  },
  async deactivate() {
    activeProvider = undefined;
    cachedApi = undefined;
    lastUserText = undefined;
  }
});
function resolveConfig(rawSection, pluginConfig) {
  const source = rawSection ?? pluginConfig ?? {};
  return {
    enabled: source.enabled ?? false,
    dbPath: source.dbPath
  };
}
export {
  src_default as default
};
