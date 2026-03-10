# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

IrisClaw 是一个模块化的 TypeScript AI 聊天框架，支持多平台（Console、Discord、Telegram、Web）、多 LLM 提供商（Gemini、OpenAI 兼容、Claude）、工具调用和流式输出。内部统一使用 **Gemini Content 格式** 作为数据表示，非 Gemini 提供商通过 `FormatAdapter` 进行双向格式转换。

## 常用命令

```bash
npm run setup        # 首次安装：根目录 + web-ui 依赖
npm run dev          # 开发模式（tsx 热重载，仅后端）
npm run dev:ui       # 前端开发（Vite dev server，代理 /api 到后端）
npm run build        # 构建前端 + 编译 TypeScript 到 dist/
npm run build:ui     # 仅构建前端（web-ui/dist/）
npm start            # 运行编译后的 dist/index.js
```

未配置测试框架和代码检查工具。

## 配置

将 `config.example.yaml` 复制为 `config.yaml` 并填写 API 密钥/令牌。

| 配置块 | 关键字段 |
|--------|----------|
| `llm` | 三层路由：`primary`(必填)、`secondary`(可选)、`light`(可选)，每层含 `provider`/`apiKey`/`model`/`baseUrl`。回退链：light→secondary→primary |
| `platform` | `type`(`console`/`discord`/`telegram`/`web`)、对应平台的 `token` 或 `web.port`/`web.host`/`web.authToken`/`web.managementToken` |
| `storage` | `type`(`json-file`/`sqlite`)、`dir`、`dbPath` |
| `system` | `systemPrompt`、`maxToolRounds`、`stream`、`maxAgentDepth`(默认 3) |
| `memory` | `enabled`(默认 false)、`dbPath`(默认 `./data/memory.db`) |
| `mcp` | `servers` 对象，每个服务器含 `transport`(`stdio`/`http`)、连接参数、`timeout`、`enabled` |
| `cloudflare` | 可选，`apiToken`、`zoneId`（通过 Web GUI 配置，支持环境变量和文件三种来源） |

## 架构

**消息流：**
```
用户 → PlatformAdapter → Orchestrator → PromptAssembler → LLMRouter → LLMProvider → (ToolRegistry 循环) → PlatformAdapter → 用户
                              ↕                ↕                                            ↕
                        StorageProvider   MemoryProvider                              MCPManager
```

**核心层：**

- **平台层** (`src/platforms/`)：Console、Discord、Telegram、Web 适配器，继承 `PlatformAdapter` 抽象基类。平台可覆写 `sendMessageStream()` 实现流式输出（默认回退为收集全文后一次性发送）。
- **LLM 提供商层** (`src/llm/`)：采用**组合模式**——`LLMProvider` 类组合 `FormatAdapter`（格式转换）+ `EndpointConfig`（URL/Headers），由工厂函数（如 `createGeminiProvider`）创建实例。HTTP 传输位于 `transport.ts`，响应解析位于 `response.ts`。
  - **三层路由** (`router.ts`)：`LLMRouter` 按调用场景分配 Provider——primary(首轮对话)、secondary(工具后续轮次)、light(辅助任务预留)，未配置的层级自动向上回退
  - 当前提供商：Gemini（原生格式）、OpenAI 兼容、Claude
  - 格式适配器 (`src/llm/formats/`)：实现 `FormatAdapter` 接口，负责 `encodeRequest` / `decodeResponse` / `decodeStreamChunk` 的双向转换
  - 工厂 (`factory.ts`)：`createLLMFromConfig` 创建单个 Provider，`createLLMRouter` 创建三层路由器
- **存储层** (`src/storage/`)：聊天历史持久化，继承 `StorageProvider` 基类。实现：JSON 文件（默认）、SQLite（WAL 模式）。
- **记忆层** (`src/memory/`)：可选的长期记忆系统，继承 `MemoryProvider` 基类。SQLite + FTS5 全文检索实现。Orchestrator 每次请求自动调用 `buildContext()` 搜索相关记忆注入系统提示词（per-request extraParts，不修改共享状态）。同时提供 `memory_search`/`memory_add`/`memory_delete` 工具让 LLM 自主读写记忆。
- **MCP 层** (`src/mcp/`)：连接外部 MCP 服务器，自动将其工具转换为 `ToolDefinition` 注入 `ToolRegistry`，对 LLM 透明。详见下方 MCP 章节。
- **工具层** (`src/tools/`)：`ToolRegistry` 管理工具的注册、卸载与执行。支持 `unregister()` 供 MCP 热重载使用。内置工具位于 `src/tools/builtin/`。
- **子 Agent 层** (`src/core/agent-types.ts`, `src/core/agent-executor.ts`)：支持 LLM 委派子任务给独立 Agent。详见下方子 Agent 章节。
- **提示词层** (`src/prompt/`)：`PromptAssembler` 从系统提示词、历史记录、工具声明和生成配置组装 `LLMRequest`。支持 `extraParts` 参数按请求注入额外上下文（如记忆），避免修改共享状态。
- **编排器** (`src/core/orchestrator.ts`)：协调完整的消息→响应流程，包括多轮工具执行循环（受 `maxToolRounds` 限制）。
- **日志** (`src/logger/`)：通过 `createLogger(tag)` 创建带模块标签的 logger。

**入口文件：** `src/index.ts` 加载配置、实例化所有模块并启动 Orchestrator。初始化顺序：LLM Router → 存储 → 记忆 → 工具 → MCP（后台异步）→ 子 Agent → 平台 → 提示词 → 编排器。

## MCP（Model Context Protocol）

`src/mcp/` 实现外部 MCP 服务器连接，将远程工具自动注入到 LLM 工具列表。

**架构：**
- `MCPClient`（`client.ts`）：封装单个 MCP 服务器连接。SDK 是 ESM-only，通过动态 `import()` 加载（路径必须带 `.js` 后缀，否则编译后 CJS 模式找不到模块）
- `MCPManager`（`manager.ts`）：多服务器管理 + 工具格式转换。`Promise.allSettled` 并行连接，单个失败不影响其他
- 配置解析（`src/config/mcp.ts`）：校验 transport 类型和必填字段

**工具命名：** `mcp__<sanitized_server>__<sanitized_tool>`，名称中非 `[a-zA-Z0-9_]` 字符替换为下划线（兼容 Gemini 函数名规范）

**两种传输：**
- `stdio`：本地进程（command + args），需要 `StdioClientTransport`
- `http`：远程服务器（URL + 可选 headers），使用 `StreamableHTTPClientTransport`（非已废弃的 SSEClientTransport）

**生命周期：**
- 启动时**后台异步连接**，不阻塞应用启动。连接完成后自动注册工具
- 连接失败只记录警告，不 throw，其他功能正常运行
- 热重载时先完成 reload 再卸载旧工具，防止 reload 失败导致工具丢失

**ESM 兼容注意事项：** 动态 import 路径必须包含 `.js` 扩展名（如 `@modelcontextprotocol/sdk/client/streamableHttp.js`），因为 SDK 的 package.json exports 通配符 `"./*"` 在 CJS `require()` 模式下不会自动加后缀。tsx 开发模式能处理，但编译后的 `dist/` 不行。

## 子 Agent 系统

`src/core/agent-types.ts` + `src/core/agent-executor.ts` + `src/tools/builtin/agent.ts`

**机制：** LLM 通过 `agent` 工具委派子任务，`AgentExecutor` 创建独立的轻量编排循环（无持久化、无流式、独立历史记录）。

**默认 Agent 类型（`createDefaultAgentTypes()`）：**
- `general-purpose`：多步骤通用任务（secondary 层，10 轮）
- `explore`：只读文件/终端访问（light 层，20 轮，工具白名单）
- `recall`：记忆搜索（light 层，3 轮，仅记忆模块启用时注册）

**深度控制：** `maxAgentDepth`（默认 3）限制嵌套层数，`agent` 工具默认从子 Agent 的工具列表中排除，防止递归

**工具过滤：** 两种模式——白名单（`allowedTools`，仅指定工具可用）和黑名单（`excludedTools`，排除指定工具）

## 核心类型

均定义于 `src/types/`：
- `Content`（role + Part[]）：全局统一使用的 Gemini 消息格式，role 只有 `'user'` | `'model'`
- `Part`：TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart
- `LLMRequest` / `LLMResponse`：请求/响应封装
- `LLMStreamChunk`：流式响应的单个数据块（textDelta、functionCalls、usageMetadata、thoughtSignature）
- `ToolDefinition`：`declaration`（FunctionDeclaration，供 LLM 识别）+ `handler`（实际执行函数）
- `FormatAdapter`（`src/llm/formats/types.ts`）：格式适配器接口

## 关键设计决策

- **工具结果存储格式**：工具执行结果（`FunctionResponsePart[]`）以 `role: 'user'` 存入历史，遵循 Gemini API 约定
- **流式输出**：Orchestrator 将 LLM 的 `AsyncGenerator<LLMStreamChunk>` 转换为纯文本 `AsyncIterable<string>` 交给平台输出，同时内部累积完整的 `Content` 用于存储
- **思考签名**：支持 Gemini 的 `thoughtSignature` 字段，流式接收后附加到 text part 和 function call parts 上，确保回传时保留
- **Web 平台 SSE**：Web GUI 统一使用 SSE 协议返回响应（即使非流式模式），因为编排器可能多次调用 `sendMessage`（工具循环）。同 session 拒绝并发请求（409）
- **记忆并发安全**：记忆上下文通过 `PromptAssembler.assemble()` 的 `extraParts` 参数注入，不修改共享的 `systemParts`，避免多 session 并发时记忆泄漏
- **记忆搜索策略**：FTS5 查询清洗特殊字符并限制 10 个 token，使用 OR 连接 + BM25 排序，防止长消息因 AND 过度严格而匹配不到
- **三层 LLM 路由**：Orchestrator 通过 `LLMRouter` 而非直接持有 `LLMProvider`，工具循环第 1 轮用 primary，第 2 轮起用 secondary，light 预留给辅助任务。未配置的层级自动回退（light→secondary→primary）
- **MCP 后台连接**：MCP 服务器在应用启动时后台异步连接，不阻塞启动。避免 MCP 不可用时拖慢或阻止启动

## Web 平台

`src/platforms/web/` 提供基于浏览器的 AI 对话界面：

- **后端**：Node.js 原生 `http` + 轻量 `Router`（零新依赖），API handlers 位于 `src/platforms/web/handlers/`
- **前端**：Vue 3 + Vue Router + Markdown-it，Vite 构建，源码位于 `web-ui/`，产物输出到 `web-ui/dist/`
- **API**：`POST /api/chat`（SSE）、`GET/DELETE /api/sessions`、`GET/PUT /api/config`、`GET /api/status`、部署相关（`/api/deploy/*`）、Cloudflare 管理（`/api/cloudflare/*`）
- **SSE 事件类型**：`delta`（流式文本块）、`message`（完整文本）、`stream_end`、`done`、`error`
- **静态文件路径**：运行时动态解析，dev（tsx）和 prod（dist）都兼容

`WebPlatform` 构造需要额外依赖（`storage`、`tools`、`configPath`），因此 `src/index.ts` 中存储和工具在平台之前创建。

**认证体系（双 Token）：**
- `authToken`：全局 `/api/*` 路由保护，通过 `Authorization: Bearer <token>` 校验
- `managementToken`：仅保护管理接口（`/api/config`、`/api/deploy/*`、`/api/cloudflare/*`），通过 `X-Management-Token` 头校验，使用 `crypto.timingSafeEqual` 防时序攻击

**配置 API 脱敏机制**：`GET /api/config` 对 apiKey、platform token、Cloudflare apiToken、MCP Authorization 等敏感字段返回 `****` + 后4位；`PUT /api/config` 的 `deepMerge` 自动跳过以 `****` 开头的值。

**配置热重载**：`PUT /api/config` 写文件后触发 `onReload` 异步回调，依次重建 LLM Router、更新运行时参数、重载 MCP 连接。在 `onReload` 完成后才返回响应，前端可立即查询 `/api/status` 获取最新状态。

**前端自动保存**：`SettingsPanel.vue` 对所有配置状态（tiers、systemPrompt、stream、MCP 服务器等）设置 deep watch，变动后 1 秒去抖自动调用 `PUT /api/config`，无需手动点保存。`configLoaded` 标志防止初始加载时误触发。保存成功后自动刷新工具列表。

**Cloudflare 管理**：`src/platforms/web/cloudflare/` 提供 DNS 记录管理、SSL 模式设置。Token 支持三种来源（inline 配置、环境变量 `CLOUDFLARE_API_TOKEN`、文件 `.cloudflare-token`）。

**部署生成器**：`src/platforms/web/deploy/` 根据表单输入生成 Nginx 反代配置和 systemd 服务文件，集成 Cloudflare 上下文提供智能推荐。

## 添加新组件

- **新平台**：在 `src/platforms/` 中继承 `PlatformAdapter`，实现 `start()`/`stop()`/`sendMessage()`，在 `src/index.ts` 的 switch 中注册
- **新 LLM 提供商**：
  1. 在 `src/llm/formats/` 中实现 `FormatAdapter` 接口（编解码逻辑）
  2. 在 `src/llm/providers/` 中创建工厂函数，用 `new LLMProvider(format, endpoint, name)` 组合
  3. 在 `src/config/types.ts` 的 `LLMConfig['provider']` 联合类型中注册 provider 名称
  4. 在 `src/config/llm.ts` 的 `DEFAULTS` 和 `web-ui/src/components/SettingsPanel.vue` 的 `PROVIDER_DEFAULTS` 中添加默认 model/baseUrl
  5. 在 `src/llm/factory.ts` 的 `createLLMFromConfig` switch 中添加分支
- **新工具**：在 `src/tools/builtin/` 中导出 `ToolDefinition` 对象（参考 `example.ts`），在 `src/index.ts` 中 import 并加入 `tools.registerAll()`
- **新存储**：在 `src/storage/` 中继承 `StorageProvider`
- **新记忆提供商**：在 `src/memory/` 中继承 `MemoryProvider`，实现 `add`/`search`/`list`/`delete`/`clear`，可选覆写 `buildContext()` 自定义注入格式
- **新 Agent 类型**：在 `src/core/agent-types.ts` 的 `createDefaultAgentTypes()` 中添加，指定 `systemPrompt`、工具过滤规则（`allowedTools` 或 `excludedTools`）、LLM 层级（`tier`）和最大轮次

详细扩展指南见 `docs/` 目录。

## Windows 一键部署

`start.bat` + `scripts/*.bat` 实现解压即用，无需预装 Node.js：

```
start.bat                    # 入口：清理残留端口 → 调用子脚本 → 前台运行 node
scripts/
├── env.bat                  # 公共环境变量（Node v22.14.0、路径常量）
├── setup-node.bat           # 检测/下载 Node.js 便携版（PowerShell）
├── setup-deps.bat           # npm install + npm run build（有缓存跳过）
└── setup-config.bat         # 首次生成 config.yaml（Web GUI 默认配置）
```

首次运行自动下载 Node.js → 安装依赖 → 构建 → 提示填写 API Key → 启动 + 打开浏览器。再次运行跳过所有安装步骤，秒启动。启动前自动检测并清理端口占用的残留进程，异常退出时 pause 显示错误信息。

## Linux 部署

`deploy/` 目录包含生产部署配置文件：
- `irisclaw.service`：systemd 服务文件
- `nginx.conf`：Nginx 反代配置（HTTPS + Let's Encrypt + SSE 特殊处理）

详见 `docs/deploy.md`。

## 约定

- TypeScript 严格模式，ES2022 目标，CommonJS 模块
- 需要 Node.js >=18.0.0
- `config.yaml`、`data/`、`.env` 已加入 gitignore —— 禁止提交密钥
- 所有中文注释和日志
- ESM-only 依赖（如 `@modelcontextprotocol/sdk`）通过动态 `import()` 加载，路径需带 `.js` 后缀确保编译后 CJS 正常工作
