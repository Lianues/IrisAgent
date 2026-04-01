# Iris Backend 队列化重构：审查与修复记录

本文档记录 Iris Backend 队列化改造（阶段一）代码审查中发现的问题及其修复。

## 改造背景

Iris 原先的 `Backend.chat()` 是同步阻塞式的：用户发一条消息，`handleMessage()` 从头跑到尾，turn 结束后才能接收下一条。本次改造引入消息队列（MessageQueue）和 per-session turn 锁（TurnLock），将 `chat()` 从"直接执行"改为"入队 + 自动调度"。

## 涉及文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/core/message-queue.ts` | 新增 + 修复 | 统一消息队列 |
| `src/core/turn-lock.ts` | 新增 | Per-session turn 锁 |
| `src/core/agent-task-registry.ts` | 新增 | 异步子代理任务注册表 |
| `src/core/backend/backend.ts` | 改动 + 修复 | Backend 核心：队列调度、turn 执行、runTurnCore 提取 |
| `src/core/backend/types.ts` | 改动 | 新增 agent:notification 事件、asyncSubAgents 配置 |
| `src/core/backend/index.ts` | 改动 | 导出新类型 |
| `src/tools/internal/sub-agent/index.ts` | 改动 | 异步子代理执行路径 |
| `src/tools/internal/sub-agent/types.ts` | 改动 | background 字段、引导文本 |
| `src/config/types.ts` | 改动 | SubAgentTypeDef.background、SystemConfig.asyncSubAgents |
| `src/config/system.ts` | 改动 | 解析 asyncSubAgents 字段 |
| `src/config/sub_agents.ts` | 改动 | 解析 background 字段 |
| `src/bootstrap.ts` | 改动 | 注入异步子代理依赖 |
| `tests/backend-queue.test.ts` | 新增 | Backend 队列化集成测试 |
| `tests/message-queue.test.ts` | 新增 | 消息队列单元测试 |
| `tests/turn-lock.test.ts` | 新增 | Turn 锁单元测试 |
| `tests/agent-task-registry.test.ts` | 新增 | 任务注册表单元测试 |
| `tests/async-sub-agent.test.ts` | 新增 | 异步子代理集成测试 |

---

## 发现的问题与修复

### 问题一（严重）：drainQueue 无限递归

**现象**

`drainQueue()` 在遇到被 turn 锁占用的 session 时，先 `dequeue()` 取出消息，再用 `enqueueUser()` / `enqueueNotification()` 放回。放回操作触发 `emit('enqueued')`，而构造函数注册了 `messageQueue.on('enqueued', () => this.drainQueue())`，因此同步递归调用 `drainQueue()`，形成无限递归直至栈溢出。

**触发条件**

用户在上一轮 turn 尚未结束时发送新消息。这在 Iris 的多平台场景中（Telegram、Discord、Web 等）是常规操作，不是边界条件。

**根因分析**

Iris 用 EventEmitter 替代 React 的响应式系统，但 `EventEmitter.emit()` 是同步调用监听器的，没有渲染周期的间隔保护。

**修复方案**

综合 Node.js 官方文档（`ERR_EVENT_RECURSION`）和社区共识，采用布尔重入守卫：

1. 新增 `private _draining = false` 字段。
2. `drainQueue()` 入口检查 `_draining`，正在 drain 时直接返回。
3. 消息已在队列中不会丢失，当前循环或下一次非递归触发会处理它。

同时消除了 re-enqueue 的副作用：

1. `MessageQueue` 新增 `requeue(msg)` 方法，不触发 `emit('enqueued')`，不覆盖时间戳。
2. `dequeue()` 和 `peek()` 新增 `excludeSessions` 参数，`drainQueue` 用 `busySessions` 集合跳过锁定的 session，避免反复取出同一 session 的消息。

**改动文件**

- `src/core/message-queue.ts`：新增 `requeue()`、`dequeue`/`peek` 增加 `excludeSessions` 参数
- `src/core/backend/backend.ts`：新增 `_draining` 守卫、重写 `drainQueue()`

---

### 问题二（中等）：chat() Promise 被 notification turn 的 done 事件提前 resolve

**现象**

`chat()` 返回的 Promise 通过监听 `done` 事件并按 `sessionId` 匹配来 resolve。当同一 session 上有 notification turn（异步子代理完成通知）时，notification turn 的 `done` 事件也携带相同的 `sessionId`，会错误地将用户消息的 Promise 提前 resolve。

**触发时序**

1. 用户消息 A 的 turn 完成，其间启动了异步子代理。
2. 子代理完成，notification 入队并开始 notification turn。
3. 用户发送消息 B，`chat()` 创建 Promise_B 并监听 `done`。
4. notification turn 完成，emit `done(sessionId)` — Promise_B 被错误 resolve。
5. 消息 B 的 turn 尚未开始，平台层误以为消息 B 已处理完毕。

**修复方案**

参考 Stack Overflow 高票答案的结论：当多个异步操作共享同一个 EventEmitter 时，必须通过唯一标识将事件与对应的 Promise 配对。

1. `QueuedMessage` 接口新增 `turnId` 字段。
2. `enqueueUser()` 和 `enqueueNotification()` 在入队时自动生成唯一 turnId（格式 `turn_<自增计数>_<时间戳>`）。
3. `enqueueUser()` 返回生成的 turnId。
4. `chat()` 获取 turnId，其 Promise 监听 `done` 事件时用 turnId 配对。
5. `runTurnCore()` 和 `executeTurn()` 中所有 `emit('done', ...)` 携带 turnId 作为第三个参数。
6. 平台层现有的 `done` 事件监听器不受影响——多余的参数被忽略。

**改动文件**

- `src/core/message-queue.ts`：`QueuedMessage` 新增 `turnId`、入队方法生成 turnId、`enqueueUser` 返回 turnId
- `src/core/backend/backend.ts`：`chat()` 用 turnId 配对、`executeTurn` 和 `runTurnCore` 的 done 事件携带 turnId

---

### 问题三（结构性）：handleNotificationTurn 与 handleMessage 大量代码重复

**现象**

两个方法约 80 行代码完全相同：callLLM 构建、模式工具过滤、ToolLoop 创建与执行、abort/error 处理、fallback model 消息、durationMs 写入、storage 更新。差异仅在前置准备（sanitize、auto-compact、undo/redo、token 统计、用户消息存储）和后置处理（meta 更新、插件钩子、post-compact）。

**修复方案**

采用 Options Object 模式（业界推荐，避免为同一类内部的路径差异引入继承层级）：

提取 `runTurnCore(options)` 私有方法，接收选项对象：

```typescript
private async runTurnCore(options: {
  sessionId: string;
  turnId: string;
  history: Content[];
  signal?: AbortSignal;
  updateMeta: boolean;        // handleMessage: true,  notification: false
  runAfterChatHooks: boolean; // handleMessage: true,  notification: false
  postCompact: boolean;       // handleMessage: true,  notification: false
  storedUserParts?: Part[];   // 仅 handleMessage 路径
  platformName?: string;      // 仅 handleMessage 路径
}): Promise<void>
```

`handleMessage` 保留用户消息专有的前置步骤，然后调用 `runTurnCore` 并传入全部开关为 true。`handleNotificationTurn` 保留 notification 专有的前置步骤，然后调用 `runTurnCore` 并传入全部开关为 false。

**改动文件**

- `src/core/backend/backend.ts`：新增 `runTurnCore()`、精简 `handleMessage()` 和 `handleNotificationTurn()`

---

### 问题四（次要）：types.ts Unicode 转义注释

`src/tools/internal/sub-agent/types.ts` 第 30 行 JSDoc 注释使用 Unicode 转义（`\u5f02\u6b65\u5b50\u4ee3\u7406...`），文件其他部分直接使用中文。已修正为中文。

---

## 修复前后对比

### 编译状态

- 修复前：TypeScript 编译通过
- 修复后：TypeScript 编译通过

### 测试状态

- 修复前：244 pass / 25 fail / 4 errors（失败项全部是 Telegram 扩展、extension installer 等既有问题）
- 修复后：297 pass / 25 fail / 4 errors（失败项与修复前完全一致，新增 53 个通过的测试来自队列化相关测试文件）

### 代码量变化

`backend.ts` 从 1222 行减少到 1170 行（净减 52 行），消除了 handleNotificationTurn 中约 80 行与 handleMessage 重复的代码，同时新增了 runTurnCore 方法和 drainQueue 重入保护逻辑。

---

## 架构设计说明

| 组件 | 实现 |
|---|---|
| 消息队列 | `MessageQueue`（EventEmitter 子类） |
| 并发保护 | `TurnLock`（两状态：idle/running）+ `_draining` 重入守卫 |
| 调度触发 | EventEmitter `on('enqueued'/'released')` + 布尔守卫防递归 |
| 队列处理 | `drainQueue()`（由事件监听器调用） |
| turn 执行 | `executeTurn()` → `handleMessage()`/`handleNotificationTurn()` → `runTurnCore()` |
| 优先级 | 两级（user/notification） |
| 事件配对 | turnId 配对 done 事件 |

TurnLock 采用两状态状态机（idle/running），因为 Iris 用 EventEmitter 驱动，dequeue 和处理之间没有异步间隙，不需要额外的 dispatching 状态。`chat()` 入队后通过 done 事件得知 turn 结束，需要 turnId 防止同 session 上不同 turn 的 done 事件错配。

---

## 遗留事项

以下事项不在本次修复范围，可在后续迭代中处理：

1. **阶段二至四的计划内容**（异步子代理系统提示词引导、平台层适配、向后兼容检查）——按原计划推进。
2. **agent-task-registry 模块级 taskCounter**——多个 AgentTaskRegistry 实例共享计数器，不影响正确性但可能造成 ID 跳号。如需隔离可改为实例级计数器。
