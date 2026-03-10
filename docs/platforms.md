# 用户交互层

## 职责

平台适配器负责将用户输入转换为 `Backend.chat()` 调用，并监听 Backend 事件将结果转换为平台特定的输出。

平台与 Backend 的关系是单向依赖：

```
Platform ──调方法──▶ Backend
Platform ◀──听事件── Backend
```

Backend 不知道任何平台的存在。

## 文件结构

```
src/platforms/
├── base.ts              PlatformAdapter 抽象基类
├── console/index.ts     控制台 TUI（Ink/React）
├── discord/index.ts     Discord Bot
├── telegram/index.ts    Telegram Bot
└── web/                 Web GUI
    ├── index.ts         WebPlatform（HTTP + SSE）
    ├── router.ts        轻量路由
    ├── handlers/        API 处理器
    ├── security/        安全模块
    ├── deploy/          部署配置生成器
    └── cloudflare/      Cloudflare 集成
```

## 基类：PlatformAdapter

```typescript
abstract class PlatformAdapter {
  /** 启动平台 */
  abstract start(): Promise<void>;

  /** 停止平台 */
  abstract stop(): Promise<void>;

  /** 平台名称 */
  get name(): string;
}
```

基类只定义生命周期接口。不包含任何回调注册、消息发送方法。

## 平台适配模式

所有平台适配器遵循同一模式：

```typescript
class XxxPlatform extends PlatformAdapter {
  private backend: Backend;

  constructor(backend: Backend, ...) {
    this.backend = backend;
  }

  async start() {
    // 1. 监听 Backend 事件
    this.backend.on('response', (sid, text) => { /* 输出到用户 */ });
    this.backend.on('stream:chunk', (sid, chunk) => { /* 流式输出 */ });
    // ...

    // 2. 监听用户输入
    this.on('userMessage', (text) => {
      this.backend.chat(this.sessionId, text);
    });
  }
}
```

### 关键约束

- 平台层不包含任何 AI/LLM 逻辑
- 平台层不直接访问存储层（通过 Backend API）
- 多个平台可以共用同一个 Backend 实例，通过 sessionId 隔离
- 事件回调中通过 sessionId 过滤自己关心的会话

---

## 各平台说明

### Console

基于 Ink 5+ / React 18 的 TUI 界面。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, modeName?)` |
| sessionId | 启动时生成时间戳 ID，如 `20250715_143052_a7x2` |
| 流式支持 | 支持，通过 `stream:chunk` 事件逐块显示 |
| 工具状态 | 通过 `tool:update` 事件实时显示 |
| 指令 | `/new` 新建对话、`/load` 加载历史、`/sh <命令>` 执行命令、`/exit` 退出 |
| 会话管理 | `/load` 通过 `backend.listSessionMetas()` 获取列表，选择后通过 `backend.getHistory()` 加载 |

### Discord

基于 discord.js 官方 SDK。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { token })` |
| sessionId | `discord-{channelId}` |
| 流式支持 | 不支持（Discord 无流式接口），仅监听 `response` 事件 |
| 消息限制 | 自动分段，每段最多 2000 字符 |

### Telegram

基于 grammY 官方 SDK。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { token })` |
| sessionId | `telegram-{chatId}` |
| 流式支持 | 不支持，仅监听 `response` 事件 |
| 消息限制 | 自动分段，每段最多 4096 字符 |

### Web

基于 Node.js 原生 `http` 模块，零新依赖。前端为 Vue 3 + Vite。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { port, host, authToken?, managementToken?, configPath, ... })` |
| sessionId | 客户端传入，或自动生成 `web-{uuid}` |
| 流式支持 | 支持，通过 SSE 推送 `delta` / `stream_end` 事件 |
| 热重载 | 通过 `backend.reloadLLM()` / `backend.reloadConfig()` 实现 |

#### Web 平台事件映射

| Backend 事件 | SSE 事件 |
|---|---|
| `response` | `{ type: 'message', text }` |
| `stream:chunk` | `{ type: 'delta', text }` |
| `stream:end` | `{ type: 'stream_end' }` |

#### Web API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息（SSE 响应） |
| GET | `/api/sessions` | 列出会话 |
| GET | `/api/sessions/:id/messages` | 获取会话消息 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| DELETE | `/api/sessions/:id/messages?keepCount=N` | 截断历史 |
| GET | `/api/config` | 获取配置（敏感字段脱敏） |
| PUT | `/api/config` | 更新配置（触发热重载） |
| GET | `/api/status` | 服务器状态 |

#### Web 平台内部方法

供 `chat handler` 等内部模块调用：

| 方法 | 说明 |
|------|------|
| `hasPending(sessionId)` | 检查是否有正在处理的 SSE 连接 |
| `registerPending(sessionId, res)` | 注册 SSE 响应 |
| `removePending(sessionId)` | 移除 SSE 响应 |
| `dispatchMessage(sessionId, message)` | 调用 `backend.chat()` |
| `setMCPManager(mgr)` | 注入 MCP 管理器 |
| `getMCPManager()` | 获取 MCP 管理器 |

---

## 工具函数

`splitText(text, maxLen)` — 按最大长度分段，优先在换行处切分。供有消息长度限制的平台使用。

---

## 新增平台步骤

1. 创建 `src/platforms/新平台名/index.ts`
2. 继承 `PlatformAdapter`
3. 构造函数接收 `backend: Backend` 参数
4. 在 `start()` 中监听需要的 Backend 事件（`response` / `stream:*` / `tool:update` / `error`）
5. 监听用户输入，调用 `backend.chat(sessionId, text)`
6. sessionId 建议为 `"平台名-唯一标识"`，如 `"discord-123456"`
7. 在 `src/index.ts` 中添加 import 和 switch case
