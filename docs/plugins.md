# 插件系统

## 职责

统一的第三方扩展入口。插件与 Iris 在同一进程中运行，拥有对内部组件的完整访问权限。

可扩展的能力：

- 在核心对象创建前参与系统装配（PreBootstrap）
- 注册工具、模式
- 拦截和修改工具执行（执行前 / 执行后）
- 拦截和修改 LLM 原始请求与原始响应
- 修改消息流程（用户输入 / LLM 输出）
- 监听会话生命周期（创建 / 清空）
- 直接操作系统提示词
- 注册自定义 LLM / Storage / Memory / OCR Provider
- 注册自定义平台
- 动态注册 / 移除 LLM 模型
- 访问 Backend、LLM Router、Storage 等所有内部对象
- monkey-patch 任意内部方法（patchMethod / patchPrototype）
- 注册自定义 slash 命令（所有平台通用）
- 向 Web 平台注册自定义 HTTP 路由
- 插件间通信（共享事件总线 + 插件管理器引用）
- 通过 Backend EventEmitter 发射和监听自定义事件

## 文件结构

```
src/plugins/
├── types.ts                类型定义（IrisPlugin / PluginContext / IrisAPI / PluginHook 等）
├── context.ts              PluginContextImpl（每个插件获得的独立上下文实例）
├── manager.ts              PluginManager（发现、加载、激活、停用）
├── patch.ts                通用 monkey-patch 工具（patchMethod / patchPrototype）
├── event-bus.ts            插件间共享事件总线
├── command-registry.ts     自定义 slash 命令注册表
├── prebootstrap-context.ts PreBootstrap 阶段上下文
└── index.ts                统一导出
```

---

## 插件目录

插件存放在 `~/.iris/plugins/` 下，每个插件一个子目录：

```
~/.iris/plugins/
├── my-plugin/
│   ├── index.ts          入口文件（必须 export default 一个 IrisPlugin）
│   ├── config.yaml       插件默认配置（可选）
│   └── README.md         说明文档（可选）
└── another-plugin/
    └── index.ts
```

入口文件查找顺序：`index.ts` → `index.js` → `index.mjs`

---

## 配置

`~/.iris/configs/plugins.yaml`：

```yaml
plugins:
  - name: my-plugin
    enabled: true
    config:
      apiKey: "sk-xxx"

  - name: rag
    type: npm
    priority: 100
    enabled: true

  - name: disabled-plugin
    enabled: false
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 插件名称。本地插件对应 `~/.iris/plugins/<name>/`；npm 插件对应 `iris-plugin-<name>` |
| `type` | `'local' \| 'npm'` | 否 | 插件来源类型，默认 `local` |
| `enabled` | `boolean` | 否 | 是否启用，默认 `true` |
| `priority` | `number` | 否 | 插件优先级。数值越大越先执行，默认 `0` |
| `config` | `object` | 否 | 覆盖插件自身 `config.yaml` 中的配置 |

---

## 插件接口：IrisPlugin

```typescript
interface IrisPlugin {
  name: string;
  version: string;
  description?: string;
  preBootstrap?(context: PreBootstrapContext): Promise<void> | void;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
```

- `preBootstrap()` 在 Router / Storage / Memory / OCR / 平台创建前调用
- `activate()` 在 bootstrap 流程中、Backend 创建之前调用
- `deactivate()` 在应用关闭时调用
- `name` 和 `version` 必须是非空字符串，`activate` 必须是函数

---

## 预启动阶段：PreBootstrapContext

`preBootstrap()` 用来做真正的“系统装配”。插件可以在这里修改最终生效的配置，并注册新的 Provider 或平台工厂。

```typescript
interface PreBootstrapContext {
  getConfig(): Readonly<AppConfig>;
  mutateConfig(mutator: (config: AppConfig) => void): void;
  registerLLMProvider(name: string, factory: LLMProviderFactory): void;
  registerStorageProvider(type: string, factory: StorageFactory): void;
  registerMemoryProvider(type: string, factory: MemoryFactory): void;
  registerOCRProvider(name: string, factory: OCRFactory): void;
  registerPlatform(name: string, factory: PlatformFactory): void;
}
```

示例：注册自定义 LLM Provider，并把默认模型切到插件提供的 provider：

```typescript
plugin.preBootstrap = (ctx) => {
  ctx.registerLLMProvider('my-provider', (config) => createMyProvider(config));

  ctx.mutateConfig((config) => {
    config.llm.models.push({
      modelName: 'my_model',
      provider: 'my-provider',
      apiKey: 'demo',
      model: 'my-model-id',
      baseUrl: 'https://example.com',
    });
    config.llm.defaultModelName = 'my_model';
  });
};
```

示例：注册自定义平台，并让它出现在 `platform.type` 中：

```typescript
plugin.preBootstrap = (ctx) => {
  ctx.registerPlatform('my-platform', async ({ backend, config }) => {
    return new MyPlatform(backend, config.platform['my-platform']);
  });

  ctx.mutateConfig((config) => {
    config.platform.types = ['my-platform'];
    config.platform['my-platform'] = { token: 'demo' };
  });
};
```

---

## 插件上下文：PluginContext

插件在 `activate()` 中收到一个 `PluginContext`，提供以下能力：

```typescript
interface PluginContext {
  // 工具扩展
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;

  // 模式扩展
  registerMode(mode: ModeDefinition): void;

  // 钩子
  addHook(hook: PluginHook): void;

  // 直接访问内部注册表
  getToolRegistry(): ToolRegistry;
  getModeRegistry(): ModeRegistry;
  getRouter(): LLMRouter;

  // 工具拦截
  wrapTool(toolName: string, wrapper: ToolWrapper): void;

  // 提示词操作
  addSystemPromptPart(part: Part): void;
  removeSystemPromptPart(part: Part): void;

  // 自定义命令
  registerCommand(command: PluginCommand): void;

  // 延迟初始化
  onReady(callback: (api: IrisAPI) => void | Promise<void>): void;

  // 工具方法
  getConfig(): Readonly<AppConfig>;
  getLogger(tag?: string): PluginLogger;
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;
}
```

---

## 工具注册

与内置工具格式完全一致：

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
    return { temperature: 25, city: args.city };
  },
});
```

## 工具拦截（wrapTool）

`wrapTool` 直接修改工具在 ToolRegistry 中的 handler。wrapper 接收原始 handler、参数和工具名。

```typescript
type ToolWrapper = (
  original: ToolHandler,
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;
```

示例：给 shell 工具加审计日志：

```typescript
ctx.wrapTool('shell', async (original, args, toolName) => {
  const logger = ctx.getLogger('audit');
  logger.info(`执行命令: ${args.command}`);
  const result = await original(args);
  logger.info(`命令完成`);
  return result;
});
```

示例：给 write_file 工具加备份：

```typescript
ctx.wrapTool('write_file', async (original, args) => {
  // 写入前备份原文件
  const fs = await import('fs');
  const path = args.path as string;
  if (fs.existsSync(path)) {
    fs.copyFileSync(path, path + '.bak');
  }
  return original(args);
});
```

可多次 wrapTool 同一个工具，形成洋葱式调用链。

---

## 钩子系统

通过 `ctx.addHook()` 注册。当前提供七个钩子点。每个 hook 可带 `priority`，数值越大越先执行：

### onBeforeChat

用户消息发给 LLM 前调用。可修改消息文本。

```typescript
ctx.addHook({
  name: 'preprocessor',
  onBeforeChat({ sessionId, text }) {
    return { text: text.replace(/敏感词/g, '***') };
  },
});
```

### onAfterChat

LLM 返回最终文本后、发送给用户前调用。可修改响应内容。

```typescript
ctx.addHook({
  name: 'postprocessor',
  async onAfterChat({ sessionId, content }) {
    return { content: content + '\n\n---\nPowered by MyPlugin' };
  },
});
```

### onBeforeToolExec

工具执行前调用（在 scheduler 中，审批通过后、实际执行前）。可阻止执行或修改参数。

```typescript
ctx.addHook({
  name: 'tool-guard',
  onBeforeToolExec({ toolName, args }) {
    if (toolName === 'shell' && String(args.command).includes('rm -rf')) {
      return { blocked: true, reason: '安全策略：禁止 rm -rf' };
    }
    return undefined; // 不干预
  },
});
```

返回值：

| 返回 | 效果 |
|------|------|
| `undefined` | 不干预 |
| `{ blocked: true, reason }` | 阻止执行，reason 回传给 LLM |
| `{ blocked: false, args }` | 允许执行，替换参数 |

多个插件的钩子按加载顺序链式执行。

### onAfterToolExec

工具执行完成后调用。可修改工具返回值。

```typescript
ctx.addHook({
  name: 'tool-result-redactor',
  onAfterToolExec({ toolName, result }) {
    if (toolName === 'read_file' && typeof result === 'string') {
      return { result: result.replace(/password=.*/g, 'password=***') };
    }
    return undefined;
  },
});
```

### onBeforeLLMCall

LLM 请求发出前调用。可修改完整的 `LLMRequest`，包括历史、系统提示词、工具声明、生成参数。

```typescript
ctx.addHook({
  name: 'llm-request-patcher',
  onBeforeLLMCall({ request, round }) {
    return {
      request: {
        ...request,
        generationConfig: {
          ...(request.generationConfig || {}),
          temperature: 0,
        },
      },
    };
  },
});
```

### onAfterLLMCall

LLM 原始响应返回后、写入历史前调用。可修改模型输出内容。

```typescript
ctx.addHook({
  name: 'llm-response-filter',
  onAfterLLMCall({ content }) {
    return {
      content: {
        ...content,
        parts: content.parts.map(part => 'text' in part && part.text
          ? { ...part, text: part.text.replace(/敏感信息/g, '***') }
          : part),
      },
    };
  },
});
```

### onSessionCreate / onSessionClear

会话创建或清空时调用。

```typescript
ctx.addHook({
  name: 'session-audit',
  onSessionCreate({ sessionId }) {
    console.log('session created:', sessionId);
  },
  onSessionClear({ sessionId }) {
    console.log('session cleared:', sessionId);
  },
});
```

---

## 提示词操作

插件可以直接操作系统提示词：

```typescript
// 注入一个持久的提示词片段，所有请求可见
const part = { text: '你是一个专业的代码审计员。' };
ctx.addSystemPromptPart(part);

// 移除（按引用匹配）
ctx.removeSystemPromptPart(part);
```

这两个方法直接调用 `PromptAssembler.addSystemPart()` / `removeSystemPart()`。添加的片段会出现在每次 LLM 请求的 `systemInstruction` 中。

---

## 直接访问内部注册表

```typescript
// 获取 ToolRegistry 实例——可以调用 register/unregister/get/createSubset 等所有方法
const tools = ctx.getToolRegistry();
tools.unregister('delete_file');  // 移除一个内置工具
const decls = tools.getDeclarations();  // 查看所有工具声明

// 获取 ModeRegistry 实例
const modes = ctx.getModeRegistry();
modes.register({ name: 'my-mode', systemPrompt: '...' });

// 获取 LLMRouter 实例——可以切换模型、动态注册/移除模型
const router = ctx.getRouter();
router.setCurrentModel('gpt4o');
router.registerModel({ modelName: 'my-model', provider, config });
router.unregisterModel('legacy-model');
```

---

## 延迟初始化：onReady + IrisAPI

`activate()` 在 Backend 创建之前执行，因此此时无法访问 Backend。通过 `onReady()` 注册回调，在 Backend 创建完成后获得完整的内部 API：

```typescript
interface IrisAPI {
  backend: Backend;          // EventEmitter，可监听所有内部事件
  router: LLMRouter;         // 切换模型、获取模型信息
  storage: StorageProvider;  // 会话历史、元数据
  memory?: MemoryProvider;   // 记忆层
  tools: ToolRegistry;       // 工具注册表
  modes: ModeRegistry;       // 模式注册表
  prompt: PromptAssembler;   // 提示词装配器
  config: AppConfig;         // 当前应用配置（只读）
  mcpManager?: MCPManager;   // MCP 管理器
  computerEnv?: Computer;    // Computer Use 环境实例
  ocrService?: OCRProvider;  // OCR 服务
  extensions: BootstrapExtensionRegistry; // 启动扩展注册表

  // --- 高级能力 ---
  pluginManager: PluginManager;       // 插件管理器（查询其他插件信息）
  eventBus: PluginEventBus;           // 插件间共享事件总线
  commands: PluginCommandRegistry;    // 自定义命令注册表
  patchMethod: typeof patchMethod;    // 安全替换对象方法
  patchPrototype: typeof patchPrototype; // 安全替换类原型方法
  registerWebRoute?: (method, path, handler) => void; // 向 Web 平台注册路由
}
```

示例：监听 Backend 事件、访问存储层：

```typescript
ctx.onReady((api) => {
  // 监听所有会话完成事件
  api.backend.on('done', (sessionId, durationMs) => {
    console.log(`会话 ${sessionId} 完成，耗时 ${durationMs}ms`);
  });

  // 监听所有 LLM 响应
  api.backend.on('assistant:content', (sessionId, content) => {
    // content 是完整的 Content 对象
  });

  // 读取会话历史
  const history = await api.storage.getHistory('some-session-id');

  // 切换模型
  api.router.setCurrentModel('gpt4o');

  // 动态注册模型
  api.router.registerModel({ modelName: 'local-dev', provider, config });

  // 修改系统提示词
  api.prompt.setSystemPrompt('新的系统提示词');

  // 查询 MCP 状态
  const mcp = api.mcpManager?.getServerInfo();
});
```

通过 `IrisAPI`，插件可以做到任何事情：监听事件、调用方法、读写存储、切换模型、注册新模型、修改提示词、访问 MCP / OCR / Computer Use 运行时对象，也可以继续查看和修改启动扩展注册表。

---

## 自定义命令

插件可以注册自定义 slash 命令。命令在所有平台通用。Console 平台在处理用户输入时会优先检查插件命令注册表。

```typescript
ctx.registerCommand({
  name: '/stats',
  description: '查看会话统计信息',
  handler: async (args, context) => {
    const history = await api.storage.getHistory(context.sessionId);
    return `当前会话共 ${history.length} 条消息`;
  },
});
```

命令注册后，用户在任何平台输入 `/stats` 即可触发。handler 返回的字符串会显示给用户。

```typescript
interface PluginCommand {
  name: string;         // 命令名（含 / 前缀）
  description: string;  // 帮助文本
  handler: (args: string, context: CommandContext) => Promise<string | undefined> | string | undefined;
}

interface CommandContext {
  sessionId: string;    // 当前会话 ID
  platform: string;     // 平台类型（'console' / 'web' / 'telegram' 等）
}
```

---

## monkey-patch：patchMethod / patchPrototype

插件可以直接替换任意对象上的方法。`patchMethod` 返回一个 dispose 函数，调用后恢复原始方法。支持链式叠加：多个插件可以对同一方法依次 patch，形成洋葱式调用链。

```typescript
ctx.onReady((api) => {
  // 替换 Backend.chat 方法
  const dispose = api.patchMethod(api.backend, 'chat', async (original, sessionId, text, images, documents) => {
    console.log(`[my-plugin] chat called: session=${sessionId}`);

    // 完全自定义处理
    if (text.startsWith('!echo ')) {
      api.backend.emit('assistant:text', sessionId, text.slice(6));
      return;
    }

    // 或者调用原始方法
    return original(sessionId, text, images, documents);
  });

  // 如果需要恢复原始方法
  // dispose();
});
```

通过 `patchMethod`，插件可以替换任意内部方法，包括但不限于：

- `backend.chat` — 完全接管对话流程
- `backend.getHistory` — 拦截历史读取
- `backend.addMessage` — 拦截消息写入
- `storage.addMessage` / `storage.getHistory` — 拦截存储层
- `router` 上的任意方法 — 拦截 LLM 调用

---

## 自定义 Web HTTP 路由

在 Web 平台运行时，插件可以注册自定义 HTTP 端点。`registerWebRoute` 在 WebPlatform 创建后才可用。

```typescript
ctx.onReady((api) => {
  if (api.registerWebRoute) {
    // 注册一个 GET 端点
    api.registerWebRoute('GET', '/api/plugin/status', async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', plugin: 'my-plugin' }));
    });

    // 注册一个 POST 端点，带路径参数
    api.registerWebRoute('POST', '/api/plugin/action/:actionId', async (req, res, params) => {
      const actionId = params.actionId;
      // 处理请求...
    });
  }
});
```

---

## 插件间通信

### 事件总线

`eventBus` 是一个独立的 EventEmitter，供插件之间发送和接收消息：

```typescript
ctx.onReady((api) => {
  // 插件 A：发射事件
  api.eventBus.fire('my-plugin:data-ready', { key: 'value' });

  // 插件 B：监听事件
  api.eventBus.on('my-plugin:data-ready', (data) => {
    console.log('收到数据:', data);
  });
});
```

### 查询其他插件

```typescript
ctx.onReady((api) => {
  const plugins = api.pluginManager.listPlugins();
  console.log('已加载的插件:', plugins.map(p => p.name));
});
```

### 通过 Backend 发射自定义事件

Backend 继承自 EventEmitter，插件可以直接用它发射和监听自定义事件：

```typescript
ctx.onReady((api) => {
  api.backend.emit('custom:my-event', { foo: 'bar' });
  api.backend.on('custom:my-event', (data) => {
    console.log('自定义事件:', data);
  });
});
```

---

## 钩子调用位置

```
用户发送消息
  │
  ▼
Backend.chat()
  │
  ├─→ [onBeforeChat]            ← 插件可修改 text
  │
  ├─→ buildStoredUserParts()
  ├─→ handleMessage()
  │     ├─→ [onSessionCreate]   ← 新会话时触发
  │     │
  │     ├─→ 记忆召回
  │     ├─→ LLM 调用 + 工具循环
  │     │     │
  │     │     ├─→ [onBeforeLLMCall]   ← 插件可修改完整请求
  │     │     ├─→ LLM 原始调用
  │     │     ├─→ [onAfterLLMCall]    ← 插件可修改原始响应
  │     │     ├─→ [onBeforeToolExec]  ← 插件可拦截/修改参数
  │     │     └─→ [onAfterToolExec]   ← 插件可修改工具结果
  │     │
  │     └─→ 最终响应文本
  │
  ├─→ [onAfterChat]             ← 插件可修改响应
  ├─→ [onSessionClear]          ← clearSession 时触发
  │
  ▼
平台输出
```

---

## 插件加载流程

```
bootstrap()
  │
  ├─→ 解析配置
  ├─→ [PluginManager.prepareAll()]    ← 预加载插件
  ├─→ [plugin.preBootstrap()]         ← 修改配置 / 注册 Provider / 注册平台
  ├─→ 创建 LLM Router
  ├─→ 创建 Storage / Memory / OCR
  ├─→ 注册内置工具
  ├─→ 连接 MCP
  ├─→ 注册模式
  ├─→ 创建 PromptAssembler
  │
  ├─→ [PluginManager.activateAll()]   ← 插件在这里激活
  │     ├─→ 创建 PluginContext（含 tools/modes/prompt/router）
  │     ├─→ plugin.activate(ctx)
  │     └─→ 收集插件注册的自定义命令
  │
  ├─→ 创建 Backend
  ├─→ 创建事件总线
  ├─→ 注入钩子 + LLM/Tool 拦截器
  │
  ├─→ [PluginManager.notifyReady()]   ← 插件 onReady 回调
  │     └─→ callback(IrisAPI)         ← 完整 API 包含 patchMethod / eventBus / commands
  │
  ▼
  返回 BootstrapResult
      │
      ├─→ 创建平台
      │     ├─→ WebPlatform → 绑定 registerWebRoute 到 IrisAPI
      │     └─→ ConsolePlatform → 注入 commandRegistry
      │
      ▼
    平台启动
```

---

## 与 MCP 的关系

| 维度 | MCP | 插件系统 |
|------|-----|---------|
| 扩展范围 | 仅工具 | 工具 + 模式 + 钩子 + 内部 API + 方法替换 + 命令 + 路由 |
| 运行方式 | 子进程 / 远程 | 同进程 |
| 协议 | MCP 标准协议 | Iris 内部接口 |
| 权限 | 仅工具调用 | 完整访问所有内部对象，可替换任意方法，可注册命令和路由 |

两者共存。只加工具用 MCP 就够了。要修改消息流程、拦截工具、操作提示词、监听事件、替换内部行为，用插件。

---

## 完整示例

```typescript
// ~/.iris/plugins/security-guard/index.ts
import type { IrisPlugin } from 'iris';

const plugin: IrisPlugin = {
  name: 'security-guard',
  version: '2.0.0',
  description: '安全策略插件：审计日志 + 命令拦截 + 响应追踪 + 自定义命令',

  activate(ctx) {
    const logger = ctx.getLogger();

    // 1. 包装 shell 工具：记录所有命令
    ctx.wrapTool('shell', async (original, args, toolName) => {
      logger.info(`[audit] shell: ${args.command}`);
      return original(args);
    });

    // 2. 钩子：拦截危险命令
    ctx.addHook({
      name: 'dangerous-command-blocker',
      onBeforeToolExec({ toolName, args }) {
        if (toolName === 'shell') {
          const cmd = String(args.command);
          if (cmd.includes('rm -rf /')) {
            return { blocked: true, reason: '安全策略：禁止删除根目录' };
          }
        }
        return undefined;
      },
    });

    // 3. 注入安全提示词
    ctx.addSystemPromptPart({
      text: '安全规则：禁止执行任何删除系统文件的命令。',
    });

    // 4. 注册自定义命令
    ctx.registerCommand({
      name: '/audit',
      description: '查看安全审计日志',
      handler: (args) => {
        return '最近 10 条审计日志：\n...';
      },
    });

    // 5. onReady：高级功能
    ctx.onReady((api) => {
      // 监听 Backend 事件
      api.backend.on('done', (sessionId, durationMs) => {
        logger.info(`[audit] session=${sessionId} duration=${durationMs}ms`);
      });

      // monkey-patch chat 方法：加入自定义逻辑
      api.patchMethod(api.backend, 'chat', async (original, sessionId, text, images, docs) => {
        logger.info(`[audit] chat start: session=${sessionId}`);
        const result = await original(sessionId, text, images, docs);
        logger.info(`[audit] chat end: session=${sessionId}`);
        return result;
      });

      // 注册 Web API 端点
      if (api.registerWebRoute) {
        api.registerWebRoute('GET', '/api/audit/logs', async (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ logs: [] }));
        });
      }

      // 插件间通信
      api.eventBus.fire('security-guard:ready', { version: '2.0.0' });
    });

    logger.info('安全策略插件已激活');
  },
};

export default plugin;
```

---

## 开发插件步骤

1. 在 `~/.iris/plugins/` 下创建插件目录
2. 创建 `index.ts`，导出一个 `IrisPlugin` 对象
3. 在 `activate()` 中使用 `ctx` 注册功能
4. 可选：通过 `ctx.registerCommand()` 注册自定义命令
5. 可选：通过 `ctx.onReady()` 获取 Backend 等内部对象
6. 可选：通过 `api.patchMethod()` 替换内部方法
7. 在 `~/.iris/configs/plugins.yaml` 中添加插件条目
8. 重启 Iris

## npm 包插件

```bash
bun add iris-plugin-rag
```

```yaml
plugins:
  - name: rag
    type: npm
    enabled: true
```

## 注意事项

- 插件 handler 抛出的错误会被 ToolLoop 捕获，不会崩溃
- 钩子中抛出的错误会被捕获并记录日志，不会中断流程
- `onBeforeToolExec` 拦截器中抛出的错误不会阻止工具执行
- `onAfterToolExec` / `onBeforeLLMCall` / `onAfterLLMCall` 钩子抛错时也不会中断主流程
- 插件注册的工具名不应与内置工具或 MCP 工具重名，否则会覆盖
- `wrapTool` 是永久修改，不可撤销
- `patchMethod` 返回 dispose 函数，可以恢复原始方法
- `patchPrototype` 影响类的所有实例，请谨慎使用
- `registerWebRoute` 仅在 Web 平台运行时可用，使用前需检查是否为 undefined
- `onReady` 回调在 `activate()` 之后执行，此时所有插件已加载完成
- 插件通过 `PluginContext` 和 `IrisAPI` 可以做到任何事情，包括替换内部方法、注册命令、注册路由、发射自定义事件。请确保插件代码可信
