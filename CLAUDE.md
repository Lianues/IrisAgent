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
| `platform` | `type`(`console`/`discord`/`telegram`/`web`)、对应平台的 `token` 或 `web.port`/`web.host`/`web.authToken` |
| `storage` | `type`(`json-file`/`sqlite`)、`dir`、`dbPath` |
| `system` | `systemPrompt`、`maxToolRounds`、`stream` |
| `memory` | `enabled`(默认 false)、`dbPath`(默认 `./data/memory.db`) |
| `cloudflare` | 可选，`apiToken`、`zoneId`（通过 Web GUI 配置） |

## 架构

**消息流：**
```
用户 → PlatformAdapter → Orchestrator → PromptAssembler → LLMRouter → LLMProvider → (ToolRegistry 循环) → PlatformAdapter → 用户
                              ↕                ↕
                        StorageProvider   MemoryProvider
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
- **工具层** (`src/tools/`)：`ToolRegistry` 管理工具的注册与执行，内置工具位于 `src/tools/builtin/`。
- **提示词层** (`src/prompt/`)：`PromptAssembler` 从系统提示词、历史记录、工具声明和生成配置组装 `LLMRequest`。支持 `extraParts` 参数按请求注入额外上下文（如记忆），避免修改共享状态。
- **编排器** (`src/core/orchestrator.ts`)：协调完整的消息→响应流程，包括多轮工具执行循环（受 `maxToolRounds` 限制）。
- **日志** (`src/logger/`)：通过 `createLogger(tag)` 创建带模块标签的 logger。

**入口文件：** `src/index.ts` 加载配置、实例化所有模块并启动 Orchestrator。初始化顺序：LLM Router → 存储 → 记忆 → 工具 → 平台 → 提示词 → 编排器。

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

## Web 平台

`src/platforms/web/` 提供基于浏览器的 AI 对话界面：

- **后端**：Node.js 原生 `http` + 轻量 `Router`（零新依赖），API handlers 位于 `src/platforms/web/handlers/`
- **前端**：Vue 3 + Vue Router + Markdown-it，Vite 构建，源码位于 `web-ui/`，产物输出到 `web-ui/dist/`
- **API**：`POST /api/chat`（SSE）、`GET/DELETE /api/sessions`、`GET/PUT /api/config`、`GET /api/status`、部署相关（`/api/deploy/*`）、Cloudflare 管理（`/api/cloudflare/*`）
- **SSE 事件类型**：`delta`（流式文本块）、`message`（完整文本）、`stream_end`、`done`、`error`
- **静态文件路径**：运行时动态解析，dev（tsx）和 prod（dist）都兼容

`WebPlatform` 构造需要额外依赖（`storage`、`tools`、`configPath`），因此 `src/index.ts` 中存储和工具在平台之前创建。

**配置 API 脱敏机制**：`GET /api/config` 对 apiKey 等敏感字段返回 `****` + 后4位；`PUT /api/config` 的 `deepMerge` 自动跳过以 `****` 开头的值，前端保存时也应跳过空/脱敏 apiKey 避免覆盖真实密钥。

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

详细扩展指南见 `docs/` 目录。

## Windows 一键部署

`启动.bat` + `scripts/*.bat` 实现解压即用，无需预装 Node.js：

```
启动.bat                     # 入口：调用子脚本 → 前台运行 node（关窗口即停服务）
scripts/
├── env.bat                  # 公共环境变量（Node v22.14.0、路径常量）
├── setup-node.bat           # 检测/下载 Node.js 便携版（PowerShell）
├── setup-deps.bat           # npm install + npm run build（有缓存跳过）
└── setup-config.bat         # 首次生成 config.yaml（Web GUI 默认配置）
```

首次运行自动下载 Node.js → 安装依赖 → 构建 → 提示填写 API Key → 启动 + 打开浏览器。再次运行跳过所有安装步骤，秒启动。

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
