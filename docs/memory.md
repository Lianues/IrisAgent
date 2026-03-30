# 记忆系统（Memory 插件）

## 概述

可选的长期记忆插件。跨会话持久化用户偏好、事实、笔记等信息。
提供 LLM 工具让 AI 自主读写记忆，并可自动将相关记忆注入上下文（autoRecall）。

> **架构变更**：记忆功能已从宿主内置模块（`src/memory/`）迁移为独立的 Extension 插件（`extensions/memory/`），通过 Extension SDK 与宿主交互，不再内部耦合。

## 文件结构

```
extensions/memory/
├── manifest.json              扩展清单
├── config.yaml                分发包默认配置
├── package.json               依赖声明（better-sqlite3）
└── src/
    ├── index.ts               插件入口 — definePlugin()
    ├── types.ts               MemoryEntry 类型定义
    ├── base.ts                MemoryProvider 抽象基类
    ├── tools.ts               LLM 工具（search / add / delete）
    ├── config-template.ts     ensureConfigFile 释放的默认模板
    └── sqlite/index.ts        SQLite + FTS5 实现
```

## 配置

配置文件由插件自行管理。首次启用时通过 `ensureConfigFile` SDK 自动在配置目录释放 `memory.yaml`：

```yaml
# configs/memory.yaml
enabled: false               # 是否启用
# dbPath: ./memory.db        # 数据库路径（相对于数据目录，或绝对路径）
```

## 基类接口：MemoryProvider

```typescript
abstract class MemoryProvider {
  abstract add(content: string, category?: string): Promise<number>;
  abstract search(query: string, limit?: number): Promise<MemoryEntry[]>;
  abstract list(category?: string, limit?: number): Promise<MemoryEntry[]>;
  abstract delete(id: number): Promise<boolean>;
  abstract clear(): Promise<void>;

  // 可覆写：根据用户输入构建记忆上下文，返回 undefined 表示无相关记忆
  async buildContext(userText: string, limit?: number): Promise<string | undefined>;
}
```

## LLM 工具

通过 `createMemoryTools(provider)` 创建三个工具，由插件在 `onReady` 阶段注册到工具注册表：

| 工具名 | 功能 | 必需参数 |
|--------|------|----------|
| `memory_search` | 搜索相关记忆 | `query` |
| `memory_add` | 保存新记忆 | `content`（可选 `category`） |
| `memory_delete` | 删除记忆 | `id` |

## 插件工作流程

```
activate(ctx)
  │
  ├─ ensureConfigFile('memory.yaml', 模板)   ← 首次释放配置
  ├─ readConfigSection('memory')              ← 读取配置
  │
  ├─ onReady(api)
  │   ├─ new SqliteMemory(dbPath)              ← 创建 Provider
  │   ├─ api.tools.registerAll(tools)          ← 注册 3 个工具
  │   ├─ api.tools.get('sub_agent')            ← 检测子代理
  │   │   ├─ 有 → 禁用 autoRecall，注入子代理引导文本
  │   │   └─ 无 → 启用 autoRecall
  │   └─ api.memory = provider                ← 暴露给其他插件
  │
  ├─ addHook('memory:capture-user-text')       ← onBeforeChat 捕获用户输入
  ├─ addHook('memory:auto-recall')             ← onBeforeLLMCall 首轮注入记忆上下文
  └─ addHook('memory:config-reload')           ← 配置热重载
```

### autoRecall 机制

插件通过两个钩子实现自动召回：

1. **`onBeforeChat`**：捕获用户原始输入文本（不修改）
2. **`onBeforeLLMCall`**：在本轮首次 LLM 调用前，用用户输入搜索记忆，将结果追加到 `systemInstruction.parts`

当存在子代理时，autoRecall 自动禁用——由用户自定义的 recall 子代理类型按需检索。

## SQLite 实现细节

- 使用 better-sqlite3（同步 API），开启 WAL 模式
- FTS5 全文检索虚拟表，通过触发器自动同步主表变更
- 查询清洗：剥离 FTS5 特殊字符，限制最多 10 个 token，使用 `OR` 连接 + BM25 排序
- 默认数据库路径：`<dataDir>/memory.db`

## 新增记忆存储后端

1. 在 `extensions/memory/src/` 下创建新目录，继承 `MemoryProvider`
2. 实现 `add` / `search` / `list` / `delete` / `clear` 五个抽象方法
3. 可选覆写 `buildContext()` 自定义注入格式
4. 在 `src/index.ts` 插件入口中根据配置选择实例化
