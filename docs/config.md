# 配置模块

## 职责

从项目根目录的 `config.yaml` 加载配置，提供给各模块使用。
各子配置独立解析，新增配置项只需修改对应的子文件。

## 配置文件

- `config.yaml` — 实际配置（含密钥，已加入 .gitignore）
- `config.example.yaml` — 示例模板（提交到 Git）

搜索顺序：`config.yaml` → `config.yml`

## 文件结构

```
src/config/
├── index.ts          loadConfig() 读取 YAML 并组合各子配置
├── types.ts          AppConfig 总类型定义
├── llm.ts            LLM 配置解析 + 默认值
├── platform.ts       平台配置解析
├── storage.ts        存储配置解析
├── system.ts         系统级配置解析
└── memory.ts         记忆配置解析
```

## config.yaml 完整结构

```yaml
llm:
  provider: gemini              # gemini | openai-compatible | claude
  apiKey: your-api-key-here
  model: gemini-2.0-flash
  baseUrl: https://generativelanguage.googleapis.com

platform:
  type: console                 # console | discord | telegram | web
  discord:
    token: your-discord-bot-token
  telegram:
    token: your-telegram-bot-token
  web:
    port: 8192
    host: 127.0.0.1             # 0.0.0.0 允许外部访问
    # authToken: your-secret    # 可选，配置后 /api/* 需携带 Authorization: Bearer <token>

storage:
  type: json-file               # json-file | sqlite
  dir: ./data/sessions          # json-file 的数据目录
  dbPath: ./data/irisclaw.db    # sqlite 的数据库路径

system:
  systemPrompt: ""
  maxToolRounds: 10
  stream: true

# 可选：长期记忆
memory:
  enabled: false
  dbPath: ./data/memory.db

# 可选：Cloudflare 集成（通过 Web GUI 配置）
cloudflare:
  apiToken: your-cloudflare-api-token
  zoneId: auto
```

## 默认值

| 配置项 | 默认值 |
|---|---|
| llm.provider | `gemini` |
| llm.model (gemini) | `gemini-2.0-flash` |
| llm.baseUrl (gemini) | `https://generativelanguage.googleapis.com` |
| llm.model (openai-compatible) | `gpt-4o` |
| llm.baseUrl (openai-compatible) | `https://api.openai.com` |
| llm.model (claude) | `claude-sonnet-4-6` |
| llm.baseUrl (claude) | `https://api.anthropic.com` |
| platform.type | `console` |
| platform.web.port | `8192` |
| platform.web.host | `127.0.0.1` |
| storage.type | `json-file` |
| storage.dir | `./data/sessions` |
| system.systemPrompt | 空（使用代码内默认提示词） |
| system.maxToolRounds | `10` |
| system.stream | `true` |
| memory.enabled | `false` |
| memory.dbPath | `./data/memory.db` |

## 新增配置项步骤

1. 在 `types.ts` 对应接口加字段
2. 在对应子配置文件的 parse 函数中解析并设置默认值
3. 在 `config.example.yaml` 中加上说明
