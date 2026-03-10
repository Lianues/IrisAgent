# 配置模块

## 职责

从项目根目录的 `config.yaml` 加载配置，提供给各模块使用。

- 支持 `config.yaml` / `config.yml`（按顺序查找）
- 配置结构由 `src/config/types.ts` 定义
- 各子模块独立解析（LLM / Platform / Storage / System / Memory）

## 配置文件与安全

- `config.yaml`：实际运行配置（包含敏感信息）
- `config.example.yaml`：示例模板（可提交到 Git）

建议：

```bash
chmod 600 config.yaml
```

---

## 结构总览（关键字段）

```yaml
llm:
  primary:
    provider: gemini
    apiKey: your-api-key
    model: gemini-2.0-flash
    baseUrl: https://generativelanguage.googleapis.com

platform:
  type: web
  web:
    port: 8192
    host: 127.0.0.1
    # authToken: your-global-api-token
    # managementToken: your-management-token

storage:
  type: json-file
  dir: ./data/sessions

system:
  systemPrompt: ""
  maxToolRounds: 10
  stream: true
  # maxAgentDepth: 3

# memory:
#   enabled: true
#   dbPath: ./data/memory.db

# cloudflare:
#   apiToken: your-cloudflare-api-token
#   # apiTokenEnv: IRISCLAW_CF_API_TOKEN
#   # apiTokenFile: ./data/secrets/cloudflare.token
#   zoneId: auto
```

---

## 平台 Web 认证字段

`platform.web` 下有两套令牌：

### 1) `authToken`（全局 API）

启用后，所有 `/api/*` 需要：

```http
Authorization: Bearer <authToken>
```

### 2) `managementToken`（管理面，推荐）

启用后，以下接口需要：

- `/api/config`
- `/api/deploy/*`
- `/api/cloudflare/*`

请求头：

```http
X-Management-Token: <managementToken>
```

Web UI 已支持在“管理令牌”面板中保存本地令牌，并自动附加到管理接口请求头。

---

## Cloudflare Token 来源优先级

Cloudflare 模块支持 3 种 token 来源，优先级如下：

1. `cloudflare.apiTokenEnv`（环境变量）
2. `cloudflare.apiTokenFile`（文件）
3. `cloudflare.apiToken`（明文，兼容旧配置）

推荐优先使用 `apiTokenEnv`，避免明文落盘。

---

## 默认值（节选）

| 配置项 | 默认值 |
|---|---|
| `platform.web.port` | `8192` |
| `platform.web.host` | `127.0.0.1` |
| `system.maxToolRounds` | `10` |
| `system.stream` | `true` |
| `system.maxAgentDepth` | `3` |
| `memory.enabled` | `false` |
| `memory.dbPath` | `./data/memory.db` |
| `mcp.servers.*.timeout` | `30000` |
| `mcp.servers.*.enabled` | `true` |

---

---

## MCP 配置

`mcp.servers` 定义要连接的外部 MCP 服务器，启动时后台异步连接（不阻塞启动）。

```yaml
mcp:
  servers:
    filesystem:
      transport: stdio
      command: npx
      args:
        - "-y"
        - "@modelcontextprotocol/server-filesystem"
        - "/path/to/dir"
      timeout: 30000    # 连接超时（毫秒），默认 30000
      enabled: true     # 默认 true，设为 false 禁用

    remote_tools:
      transport: http
      url: https://mcp.example.com/mcp
      headers:
        Authorization: Bearer your-token
      timeout: 30000
```

| 字段 | stdio | http | 说明 |
|------|-------|------|------|
| `transport` | 必填 | 必填 | `stdio` 或 `http` |
| `command` | 必填 | — | 要执行的命令 |
| `args` | 可选 | — | 命令参数数组 |
| `env` | 可选 | — | 额外环境变量 |
| `cwd` | 可选 | — | 工作目录 |
| `url` | — | 必填 | MCP 服务器 URL |
| `headers` | — | 可选 | HTTP 请求头（如 Authorization） |
| `timeout` | 通用 | 通用 | 连接和 listTools 超时，默认 30000ms |
| `enabled` | 通用 | 通用 | 是否启用，默认 true |

MCP 工具注册到 `ToolRegistry` 后，名称格式为 `mcp__<服务器名>__<工具名>`（非 `[a-zA-Z0-9_]` 字符替换为下划线）。

通过 Web GUI 设置中心可在线添加/删除/开关 MCP 服务器，保存后自动热重载。

---

## 子 Agent 配置

`system.maxAgentDepth`（默认 3）控制子 Agent 最大嵌套深度。

---

## 修改配置后生效方式

- Web GUI 设置中心的变更会自动保存并热重载（1 秒去抖），无需手动操作
- 通过 `/api/config` API 更新后也会自动尝试热重载
- 热重载范围：LLM 路由器、运行时参数（stream/maxToolRounds/systemPrompt）、MCP 连接
- 若返回 `restartRequired: true`，需手动重启服务
