# 插件系统

## 职责

统一的第三方扩展入口。通过插件可以在不修改 Iris 源码的前提下扩展工具、模式和流程钩子。

插件在 bootstrap 阶段加载，生命周期由 `PluginManager` 管理。

## 文件结构

```
src/plugins/
├── types.ts       IrisPlugin / PluginContext / PluginHook 等类型定义
├── context.ts     PluginContextImpl（每个插件获得的独立上下文实例）
├── manager.ts     PluginManager（发现、加载、激活、停用）
└── index.ts       统一导出

src/config/
└── plugins.ts     plugins.yaml 配置解析

data/configs.example/
└── plugins.yaml   示例配置文件
```

---

## 插件目录

插件存放在 `~/.iris/plugins/` 目录下，每个插件一个子目录：

```
~/.iris/plugins/
├── my-weather-tool/
│   ├── index.ts          入口文件（必须 export default 一个 IrisPlugin）
│   ├── config.yaml       插件默认配置（可选）
│   └── README.md         说明文档（可选）
└── another-plugin/
    └── index.ts
```

入口文件查找顺序：`index.ts` → `index.js` → `index.mjs`

---

## 配置

在 `~/.iris/configs/plugins.yaml` 中声明要加载的插件：

```yaml
plugins:
  # 本地目录插件
  - name: my-weather-tool
    enabled: true
    config:
      apiKey: "sk-xxx"

  # npm 包插件（包名为 iris-plugin-rag）
  - name: rag
    type: npm
    enabled: true

  # 禁用某个插件
  - name: some-plugin
    enabled: false
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 插件名称。本地插件对应 `~/.iris/plugins/<name>/` 目录；npm 插件对应 `iris-plugin-<name>` 包 |
| `type` | `'local' \| 'npm'` | 否 | 插件来源类型，默认 `local` |
| `enabled` | `boolean` | 否 | 是否启用，默认 `true` |
| `config` | `object` | 否 | 覆盖插件自身 `config.yaml` 中的配置 |

---

## 插件接口：IrisPlugin

每个插件必须导出一个符合 `IrisPlugin` 接口的对象：

```typescript
interface IrisPlugin {
  /** 插件唯一标识 */
  name: string;
  /** 版本号 */
  version: string;
  /** 插件描述（可选） */
  description?: string;

  /** 激活。在 bootstrap 流程中、Backend 创建之前调用。 */
  activate(context: PluginContext): Promise<void> | void;

  /** 停用（可选）。在应用关闭时调用，用于释放资源。 */
  deactivate?(): Promise<void> | void;
}
```

校验规则：

- `name` 必须是非空字符串
- `version` 必须是非空字符串
- `activate` 必须是函数
- 不满足以上条件的插件会被跳过并输出错误日志

---

## 插件上下文：PluginContext

插件在 `activate()` 中收到一个 `PluginContext` 实例，这是插件与 Iris 交互的唯一通道：

```typescript
interface PluginContext {
  // 工具扩展
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;

  // 模式扩展
  registerMode(mode: ModeDefinition): void;

  // 钩子注册
  addHook(hook: PluginHook): void;

  // 工具方法
  getConfig(): Readonly<AppConfig>;                       // 获取应用配置（只读）
  getLogger(tag?: string): PluginLogger;                  // 获取日志器
  getPluginConfig<T = Record<string, unknown>>(): T | undefined; // 获取插件配置
}
```

### 工具注册

向 `ToolRegistry` 注册新工具，注册后 LLM 即可调用：

```typescript
ctx.registerTool({
  declaration: {
    name: 'get_weather',
    description: '查询指定城市的天气',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
      },
      required: ['city'],
    },
  },
  handler: async (args) => {
    const city = args.city as string;
    return { temperature: 25, city };
  },
});
```

工具的 `declaration` 和 `handler` 格式与内置工具完全一致，参见 [tools.md](./tools.md)。

### 模式注册

向 `ModeRegistry` 注册新模式：

```typescript
ctx.registerMode({
  name: 'translator',
  description: '专业翻译模式',
  systemPrompt: '你是一名专业翻译。',
  tools: { include: ['translate'] },
});
```

模式的格式与 `modes.yaml` 中的定义一致，但插件注册的模式可以包含程序逻辑，不受纯声明式限制。

### 插件配置

插件配置由两层合并而成：

1. 插件目录下的 `config.yaml`（默认值）
2. `plugins.yaml` 中该插件的 `config` 字段（覆盖值）

```typescript
const config = ctx.getPluginConfig<{ apiKey: string; timeout?: number }>();
// config.apiKey → plugins.yaml 中的 config.apiKey
// config.timeout → 若 plugins.yaml 未指定，取 config.yaml 中的值
```

### 日志

```typescript
const logger = ctx.getLogger();
logger.info('已启动');         // 输出: [Plugin:my-plugin] 已启动

const subLogger = ctx.getLogger('HTTP');
subLogger.info('请求发送');    // 输出: [Plugin:my-plugin:HTTP] 请求发送
```

日志器遵循全局日志级别，与 Iris 内置的 `createLogger` 行为一致。

---

## 钩子系统

钩子允许插件在关键流程节点插入逻辑。通过 `ctx.addHook()` 注册：

```typescript
interface PluginHook {
  name: string;                          // 钩子名称（用于日志）
  onBeforeChat?(params): Promise<R> | R; // 消息发给 LLM 前
  onAfterChat?(params): Promise<R> | R;  // LLM 返回最终内容后
  onBeforeToolExec?(params): Promise<R> | R; // 工具执行前
}
```

### onBeforeChat

在用户消息发给 LLM 之前调用。可修改消息文本。

```typescript
ctx.addHook({
  name: 'message-preprocessor',
  onBeforeChat({ sessionId, text }) {
    // 返回修改后的文本
    return { text: text.replace(/敏感词/g, '***') };
    // 返回 undefined 表示不修改
  },
});
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` | 当前会话 ID |
| `text` | `string` | 用户消息文本 |

返回 `{ text: string }` 替换消息文本，返回 `undefined` 不修改。

### onAfterChat

在 LLM 返回最终文本内容后、发送给用户前调用。可修改响应内容。

```typescript
ctx.addHook({
  name: 'response-postprocessor',
  async onAfterChat({ sessionId, content }) {
    return { content: content + '\n\n---\nPowered by MyPlugin' };
  },
});
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` | 当前会话 ID |
| `content` | `string` | LLM 最终响应文本 |

返回 `{ content: string }` 替换响应文本，返回 `undefined` 不修改。

### onBeforeToolExec

在工具执行前调用。可阻止执行或修改参数。

```typescript
ctx.addHook({
  name: 'tool-guard',
  onBeforeToolExec({ toolName, args }) {
    if (toolName === 'shell' && String(args.command).includes('rm -rf')) {
      return { blocked: true, reason: '安全策略：禁止执行 rm -rf' };
    }
    return undefined; // 不干预
  },
});
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `toolName` | `string` | 工具名称 |
| `args` | `Record<string, unknown>` | 工具调用参数 |

返回值：

| 返回类型 | 效果 |
|----------|------|
| `undefined` | 不干预，正常执行 |
| `{ blocked: true, reason: string }` | 阻止执行，reason 作为错误信息回传给 LLM |
| `{ blocked: false, args?: object }` | 允许执行，可选替换参数 |

### 钩子执行顺序

多个插件注册的同名钩子按插件加载顺序依次执行。
`onBeforeChat` 和 `onAfterChat` 的修改是链式传递的：前一个钩子的输出作为后一个钩子的输入。

---

## 钩子调用位置

```
用户发送消息
  │
  ▼
Backend.chat()
  │
  ├─→ [onBeforeChat]          ← 插件可修改 text
  │
  ├─→ buildStoredUserParts()
  ├─→ handleMessage()
  │     │
  │     ├─→ 记忆召回
  │     ├─→ LLM 调用 + 工具循环
  │     └─→ 最终响应文本
  │
  ├─→ [onAfterChat]           ← 插件可修改响应
  │
  ▼
平台输出
```

---

## 插件加载流程

```
bootstrap()
  │
  ├─→ 创建 LLM Router
  ├─→ 创建 Storage / Memory
  ├─→ 注册内置工具
  ├─→ 连接 MCP
  ├─→ 注册 Computer Use 工具
  ├─→ 注册子代理
  ├─→ 注册模式
  │
  ├─→ [PluginManager.loadAll()]     ← 插件在这里加载
  │     ├─→ 读取 plugins.yaml
  │     ├─→ 逐个解析插件模块
  │     ├─→ 创建 PluginContext
  │     └─→ 调用 plugin.activate(ctx)
  │
  ├─→ 创建 Backend
  ├─→ 注入插件钩子到 Backend
  │
  ▼
返回 BootstrapResult
```

插件的 `activate()` 在 Backend 创建之前执行，因此插件注册的工具和模式会被 Backend 正常使用。

---

## 与 MCP 的关系

| 维度 | MCP | 插件系统 |
|------|-----|---------|
| 扩展范围 | 仅工具 | 工具 + 模式 + 钩子 |
| 运行方式 | 子进程 / 远程服务器 | 同进程 |
| 协议 | MCP 标准协议 | Iris 内部接口 |
| 适用场景 | 接入已有 MCP 服务 | 深度定制 Iris 行为 |

两者共存，不互相替代。如果只需要添加一个工具，MCP 和插件都可以。如果需要修改消息流程或注册模式，使用插件。

---

## 完整示例

以下是一个完整的翻译插件，同时注册了工具、模式和钩子：

```typescript
// ~/.iris/plugins/translator/index.ts
import type { IrisPlugin } from 'iris';

const plugin: IrisPlugin = {
  name: 'translator',
  version: '1.0.0',
  description: '文本翻译工具 + 翻译模式',

  activate(ctx) {
    const config = ctx.getPluginConfig<{ apiKey: string; defaultLang?: string }>();
    const logger = ctx.getLogger();

    // 1. 注册翻译工具
    ctx.registerTool({
      declaration: {
        name: 'translate',
        description: '将文本翻译为指定语言',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '待翻译文本' },
            targetLang: {
              type: 'string',
              description: '目标语言代码，如 en、zh、ja',
            },
          },
          required: ['text', 'targetLang'],
        },
      },
      handler: async (args) => {
        const text = args.text as string;
        const lang = args.targetLang as string;
        logger.info(`翻译: ${lang}`);
        // 调用翻译 API...
        return { translated: `[${lang}] ${text}`, from: 'auto' };
      },
    });

    // 2. 注册翻译模式
    ctx.registerMode({
      name: 'translator',
      description: '专业翻译模式，仅使用翻译工具',
      systemPrompt: '你是一名专业翻译。用户给你文本，你调用 translate 工具完成翻译。',
      tools: { include: ['translate'] },
    });

    // 3. 注册钩子
    ctx.addHook({
      name: 'translation-logger',
      onAfterChat({ content }) {
        logger.debug(`响应长度: ${content.length}`);
        return undefined;
      },
    });

    logger.info('翻译插件已激活');
  },

  async deactivate() {
    // 释放资源（关闭连接、清理定时器等）
  },
};

export default plugin;
```

对应的 `plugins.yaml` 配置：

```yaml
plugins:
  - name: translator
    enabled: true
    config:
      apiKey: "sk-xxx"
      defaultLang: "zh"
```

对应的插件默认配置 `~/.iris/plugins/translator/config.yaml`：

```yaml
apiKey: ""
defaultLang: "en"
```

最终 `ctx.getPluginConfig()` 的结果为 `{ apiKey: "sk-xxx", defaultLang: "zh" }`（`plugins.yaml` 中的值覆盖了默认值）。

---

## 开发插件步骤

1. 在 `~/.iris/plugins/` 下创建插件目录
2. 创建 `index.ts`，导出一个 `IrisPlugin` 对象
3. 在 `activate()` 中调用 `ctx.registerTool()` / `ctx.registerMode()` / `ctx.addHook()` 注册功能
4. 可选：创建 `config.yaml` 存放插件默认配置
5. 在 `~/.iris/configs/plugins.yaml` 中添加插件条目并设置 `enabled: true`
6. 重启 Iris

## npm 包插件

插件也可以作为 npm 包发布。包名约定为 `iris-plugin-<name>`。

```bash
bun add iris-plugin-rag
```

```yaml
plugins:
  - name: rag
    type: npm
    enabled: true
```

npm 插件的入口文件必须 `export default` 一个 `IrisPlugin` 对象。

## 注意事项

- 插件的 `activate()` 支持同步和异步（async）两种写法
- 插件 `handler` 抛出的错误会被 ToolLoop 捕获，转为错误信息回传给 LLM，不会导致进程崩溃
- 钩子中抛出的错误会被捕获并记录日志，不会中断消息处理流程
- 插件注册的工具名称不应与内置工具或 MCP 工具重名，否则会覆盖已有工具
- 插件按 `plugins.yaml` 中的声明顺序加载，钩子也按此顺序执行
- `deactivate()` 在应用关闭时调用；如果插件不需要释放资源，可以省略
