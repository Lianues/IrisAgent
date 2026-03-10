# 用户交互层

## 职责

接收用户消息，转换为内部格式；将 AI 回复发送给用户。
每个平台一个文件夹。

## 文件结构

```
src/platforms/
├── base.ts              PlatformAdapter 抽象基类
├── console/index.ts     控制台平台（开发调试用）
├── discord/index.ts     Discord Bot
├── telegram/index.ts    Telegram Bot
└── web/                 Web GUI 平台
    ├── index.ts         WebPlatform（HTTP 服务器 + SSE + 热重载）
    ├── router.ts        轻量路由（路径参数、JSON 解析）
    ├── handlers/        API 处理器
    │   ├── chat.ts      POST /api/chat（SSE 流式响应）
    │   ├── sessions.ts  GET/DELETE /api/sessions
    │   ├── config.ts    GET/PUT /api/config（含热重载回调）
    │   ├── deploy.ts    部署配置生成
    │   └── cloudflare.ts Cloudflare DNS/SSL 管理
    ├── security/        安全模块
    │   └── management.ts 管理接口令牌校验（timing-safe）
    ├── deploy/          部署配置生成器
    │   ├── planner.ts   Nginx/systemd 配置统一生成
    │   ├── types.ts     部署相关类型定义
    │   └── templates/   配置文件模板
    └── cloudflare/      Cloudflare 集成
        ├── client.ts    Cloudflare API 客户端
        ├── config-store.ts Token 来源管理（inline/env/file）
        ├── service.ts   DNS/SSL/Zone 业务逻辑
        └── types.ts     Cloudflare 相关类型
```

## 基类接口：PlatformAdapter

```typescript
abstract class PlatformAdapter {
  // 注册消息处理回调（由 Orchestrator 调用）
  onMessage(handler: MessageHandler): void;

  // 注册清空会话回调（由 Orchestrator 调用）
  onClear(handler: ClearHandler): void;

  // 启动平台（连接服务、开始监听）
  abstract start(): Promise<void>;

  // 停止平台
  abstract stop(): Promise<void>;

  // 向指定会话发送文本消息
  abstract sendMessage(sessionId: string, text: string): Promise<void>;

  // 流式发送消息（可选覆写）
  // 默认实现：收集全部文本后调用 sendMessage 一次性发送
  async sendMessageStream(sessionId: string, stream: AsyncIterable<string>): Promise<void>;
}
```

## 回调类型

```typescript
type MessageHandler = (message: IncomingMessage) => Promise<void>;
type ClearHandler = (sessionId: string) => Promise<void>;

interface IncomingMessage {
  sessionId: string;       // 会话标识，由平台生成
  parts: Part[];           // 用户消息内容（Gemini Part 格式）
  platformContext?: any;   // 平台特有上下文
}
```

## Web 平台

基于 Node.js 原生 `http` 模块 + 自定义轻量 `Router`（零新依赖）。前端为 Vue 3 + Vite 构建。

**关键设计：**
- 所有响应统一使用 **SSE 协议**（即使非流式模式），因为编排器可能多次调用 `sendMessage`（工具循环）
- 同 session 拒绝并发请求（409 Conflict）
- 静态文件路径运行时动态解析，dev（tsx）和 prod（dist）都兼容
- 构造需要额外依赖（`storage`、`tools`、`configPath`），因此 `src/index.ts` 中存储和工具在平台之前创建
- **双 Token 认证**：`authToken` 保护全部 `/api/*`（Bearer 头），`managementToken` 仅保护管理接口（`X-Management-Token` 头，timing-safe 比较）
- 配置 API 脱敏：`GET /api/config` 对 apiKey、platform token、Cloudflare apiToken、MCP Authorization 等敏感字段返回 `****` + 后4位；`PUT /api/config` 的 `deepMerge` 自动跳过 `****` 开头的值
- 部署 API 使用一次性 deploy token（启动时日志输出），仅限 Linux 环境
- **配置热重载**：`PUT /api/config` 保存后触发异步 `onReload` 回调，依次重建 LLM Router、更新运行时参数、重载 MCP 连接。回调完成后才返回响应
- **MCP 集成**：`WebPlatform` 持有 `MCPManager` 引用，支持热重载时替换。`setMCPManager()` / `getMCPManager()` 管理生命周期
- **前端自动保存**：设置面板对所有配置状态设置 deep watch，变动后 1 秒去抖自动保存，无需手动点击按钮

**SSE 事件类型：**

| 事件 | 说明 |
|------|------|
| `delta` | 流式文本块 |
| `message` | 完整文本消息 |
| `stream_end` | 流式结束 |
| `done` | 全部完成 |
| `error` | 错误 |

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息（SSE 响应） |
| GET | `/api/sessions` | 列出会话 |
| GET | `/api/sessions/:id/messages` | 获取会话消息 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| DELETE | `/api/sessions/:id/messages?keepCount=N` | 截断历史，保留最近 N 条 |
| GET | `/api/config` | 获取配置（敏感字段脱敏） |
| PUT | `/api/config` | 更新配置（脱敏值自动跳过） |
| GET | `/api/status` | 服务器状态 |
| GET | `/api/deploy/detect` | 检测部署环境（nginx/systemd/sudo） |
| GET | `/api/deploy/state` | 获取部署状态 |
| POST | `/api/deploy/preview` | 预览 Nginx/systemd 配置（不实际写入） |
| POST | `/api/deploy/sync-cloudflare` | 同步 Cloudflare SSL 模式 |
| POST | `/api/deploy/nginx` | 部署 Nginx 反代配置 |
| POST | `/api/deploy/service` | 部署 systemd 服务 |
| GET | `/api/cloudflare/status` | Cloudflare 连接状态 |
| POST | `/api/cloudflare/setup` | 验证并保存 CF API Token |
| GET | `/api/cloudflare/dns` | 列出 DNS 记录 |
| POST | `/api/cloudflare/dns` | 添加 DNS 记录 |
| DELETE | `/api/cloudflare/dns/:id` | 删除 DNS 记录 |
| GET | `/api/cloudflare/ssl` | 获取 SSL 模式 |
| PUT | `/api/cloudflare/ssl` | 设置 SSL 模式 |

## 工具函数

`splitText(text, maxLen)` — 按最大长度分段，优先在换行处切分。供有消息长度限制的平台使用（如 Discord 2000 字符）。

## 新增平台步骤

1. 创建 `src/platforms/新平台名/index.ts`
2. 继承 `PlatformAdapter`
3. 实现 `start()`、`stop()`、`sendMessage()`
4. 可选覆写 `sendMessageStream()` 实现逐块输出
5. 在 `start()` 中监听用户消息，收到时调用 `this.messageHandler()`
6. `sessionId` 建议为 `"平台名-唯一标识"`，如 `"discord-123456"`
7. 在 `src/index.ts` 中添加对应的 import 和 switch case

## 注意事项

- `sendMessage` 的 sessionId 与 `messageHandler` 回调中的 sessionId 对应
- 平台层不应包含任何 AI/LLM 逻辑
- 平台层可自由处理平台特有的逻辑（如消息长度截断、富文本格式转换等）
