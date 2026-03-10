# 核心协调器模块

## 职责

串联所有模块，编排完整的消息处理流程。本身不包含业务逻辑。

## 文件结构

```
src/core/
├── orchestrator.ts      Orchestrator 主协调器
├── agent-types.ts       AgentTypeRegistry 子 Agent 类型注册
└── agent-executor.ts    AgentExecutor 子 Agent 执行器
```

## Orchestrator 接口

### 构造参数

```typescript
new Orchestrator(
  platform: PlatformAdapter,    // 用户交互层
  router: LLMRouter,            // LLM 三层路由器
  storage: StorageProvider,      // 存储层
  tools: ToolRegistry,          // 工具注册中心
  prompt: PromptAssembler,      // 提示词组装器
  config?: OrchestratorConfig,  // { maxToolRounds, stream, autoRecall, agentGuidance }
  memory?: MemoryProvider,      // 记忆层（可选）
)
```

### 方法

| 方法 | 说明 |
|------|------|
| `start()` | 注册 `onMessage` + `onClear` 回调并启动平台 |
| `stop()` | 停止平台 |

### 内部流程（handleMessage）

```
1. 收到用户消息 (sessionId + Part[])
2. 存储用户消息 → storage.addMessage()
3. 查询相关记忆 → memory.buildContext(userText) → extraParts（可选）
4. 进入循环（最多 maxToolRounds 轮）：
   a. storage.getHistory() 获取历史
   b. prompt.assemble(history, toolDecls, undefined, extraParts) 组装请求
   c. 调用 LLM：
      - 流式：callLLMStream() → 边接收边输出文本 + 累积完整 Content
      - 非流式：llm.chat() → 获取完整响应
   d. storage.addMessage() 存储模型回复
   e. 检查 functionCall：
      - 有：执行工具 → 存储结果（role:'user'）→ 继续循环
      - 无：发送文本给用户 → 结束
```

### 流式调用（callLLMStream）

```
llm.chatStream(request) → AsyncGenerator<LLMStreamChunk>
  │
  ├─→ 提取 textDelta → 包装为 AsyncIterable<string> → platform.sendMessageStream()
  ├─→ 收集 functionCalls
  ├─→ 收集 usageMetadata
  ├─→ 收集 thoughtSignature（Gemini 思考签名）
  │
  ▼
累积为完整 Content { role:'model', parts }
  - thoughtSignature 附加到 text part 和 function call parts 上
```

### onClear 回调

平台触发清空会话时（如用户发送 `/clear`），Orchestrator 调用 `storage.clearHistory(sessionId)` 清空历史。

### 热重载方法

| 方法 | 说明 |
|------|------|
| `reloadLLM(router)` | 替换 LLM 路由器（原子赋值） |
| `reloadConfig(opts)` | 更新 stream、maxToolRounds、systemPrompt |
| `getRouter()` | 获取当前路由器引用（供 Agent 工具使用） |

---

## 子 Agent 系统

### AgentTypeRegistry（`agent-types.ts`）

管理可用的 Agent 类型定义。每种类型包含：

```typescript
interface AgentType {
  name: string;              // 类型标识
  description: string;       // 供 LLM 选择时参考
  systemPrompt: string;      // 子 Agent 的系统提示词
  tier: 'primary' | 'secondary' | 'light';  // 使用的 LLM 层级
  maxToolRounds: number;     // 最大工具轮次
  allowedTools?: string[];   // 白名单（仅这些工具可用）
  excludedTools?: string[];  // 黑名单（排除这些工具）
}
```

**默认 Agent 类型（`createDefaultAgentTypes()`）：**

| 类型 | 层级 | 轮次 | 工具过滤 | 用途 |
|------|------|------|----------|------|
| `general-purpose` | secondary | 10 | 黑名单（排除 agent） | 多步骤通用任务 |
| `explore` | light | 20 | 白名单（read_file、terminal） | 只读文件/终端探索 |
| `recall` | light | 3 | 白名单（memory_search） | 记忆搜索（仅记忆启用时注册） |

### AgentExecutor（`agent-executor.ts`）

轻量级编排器，为子 Agent 创建独立执行环境：

- **无平台适配器**：不直接输出给用户
- **无持久化存储**：使用内存中的历史记录
- **无流式输出**：同步收集完整响应
- **无记忆注入**：不自动搜索记忆上下文
- **独立工具集**：通过 `ToolRegistry.createFiltered()` 按 Agent 类型过滤

### agentGuidance

`buildAgentGuidance()` 根据已注册的 Agent 类型生成指导文本，注入到主 Orchestrator 的系统提示词中，教导 LLM 何时以及如何使用 `agent` 工具委派子任务。

### autoRecall

当记忆模块和 Agent 系统同时启用时，`autoRecall` 设为 `false`，禁用 Orchestrator 的自动记忆搜索，改由 `recall` 类型的子 Agent 按需搜索。

---

## 修改指南

- 如需增加消息预处理/后处理钩子，可在循环前后插入
- 新增 Agent 类型：在 `createDefaultAgentTypes()` 中添加，指定系统提示词和工具过滤规则
