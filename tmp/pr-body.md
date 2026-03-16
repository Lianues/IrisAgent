## 动机

WeCom 等平台需要 `/stop` 指令中止正在进行的 LLM 调用和工具执行。当前没有任何中止机制，发起请求后只能等待完成或超时。

此外，项目此前没有自动化测试。format adapter 层作为所有 LLM 请求的编码/解码通道，格式错误直接导致 API 400，属于高频出问题但难以人工验证的环节。

## 改动概述

### 1. 全链路 AbortController (6 文件, ~300 行新增)

从 HTTP 到 Backend API，六层穿透 AbortSignal：

| 层 | 文件 | 改动 |
|----|------|------|
| HTTP | `transport.ts` | `sendRequest` 接受 `signal`，与超时 signal 合并（`AbortSignal.any` + 降级） |
| Provider | `providers/base.ts` | `chat/chatStream` 透传 |
| Router | `router.ts` | `chat/chatStream` 透传 |
| Scheduler | `scheduler.ts` | 每批执行前检查，已 abort 的工具直接返回错误 |
| ToolLoop | `tool-loop.ts` | 每轮检查 + `buildAbortResult` 历史清理 |
| Backend | `backend.ts` | AbortController 生命周期管理 + `abortChat()` 公共方法 |

### abort 后的历史清理策略

`buildAbortResult` 从末尾往前扫描：

- 包含 `functionCall` 的 model 消息（无对应 response）→ 丢弃
- 纯 `thought` 的 model 消息 → 丢弃
- 有可见文本的 model 消息 → 保留（视为正常截断）
- 孤立的 tool response → 丢弃

保证清理后的历史不会触发任何 provider 的格式校验错误（Claude 的 `tool_use`/`tool_result` 配对、OpenAI 的 `tool_call_id` 匹配等）。

### 向后兼容

所有新参数都是可选的（`signal?: AbortSignal`）。不调用 `abortChat()` 则行为与之前完全一致。

### 2. Console TUI 交互优化

#### 快捷键调整

| 快捷键 | 行为 |
|--------|------|
| **Ctrl+C** | 退出 TUI（跨平台标准行为） |
| **ESC** | 生成中 → 中断生成；子视图 → 返回主界面；主界面空闲 → 无操作 |

#### 布局重构

参考 OpenCode 的设计语言，对 Console TUI 布局做了以下调整：

- **移除固定头部标题栏**：对话开始后不再显示占用空间的 `IRIS · model_name` 顶栏，消息区域获得完整屏幕高度。
- **输入框区域整合**：将输入框、模型信息、模式名称、上下文用量整合到底部一个带边框的区块内。模式名（如 `Normal`）高亮显示，模型名和上下文统计以暗色展示。
- **快捷键提示**：右下角显示当前可用快捷键（生成中显示 `esc 中断生成`，空闲时显示 `tab 补全`），始终显示 `ctrl+c 退出`。
- **欢迎页 Logo 居中**：无消息时的 IRIS ASCII Logo 居中显示，颜色恢复为主题紫色。
- **自动滚动**：消息区域增加 `stickyScroll` + `stickyStart="bottom"`，新消息自动滚动到底部。

#### ~~流式消息去重~~（已由上游修复，本 PR 移除）

此 bug（流式 `endStream()` commit 后 `finalizeAssistantParts` 重复写入）已由上游 `6c07ecc` 通过 `uncommittedStreamPartsRef` 暂存机制修复。本 PR 中原有的 `isStreamingCycle` 方案已移除，避免死代码。

### 3. /undo 和 /redo 指令

新增消息撤销与恢复功能：

| 指令 | 行为 |
|------|------|
| `/undo` | 删除消息列表最后一条（不区分 user / assistant / tool_use） |
| `/redo` | 恢复上一次 `/undo` 删除的消息 |

实现细节：

- redo 栈上限 200 条，超出时丢弃最早的条目
- 纯内存缓存，退出 TUI 后自动清空
- 新消息写入（用户发送、AI 回复）时自动清空 redo 栈
- 前端操作同步 backend storage：undo 调用 `truncateHistory`，redo 调用 `addMessage` 写回
- 逻辑提取为独立模块 `undo-redo.ts`，附带 15 个单元测试

### 4. Code Review 修复

#### Blocker: `waitForApproval` 未响应 AbortSignal

`waitForApproval()` 在等待审批期间不响应 `AbortSignal`。如果工具进入 `awaiting_approval` 后用户触发中止，等待永远不会结束，`backend.chat()` 无法退出。

修复（`src/tools/state.ts` + `src/tools/scheduler.ts`）：

- `waitForApproval(id, signal?)` 新增可选 `signal` 参数
- 已 aborted 的 signal 传入时立即返回 `false`，工具转 `error`
- 等待期间同时监听 `stateChange` 和 `signal.abort`，先触发者结束等待
- 结束时统一清除所有监听，防止内存泄漏
- `executeSingle()` 透传 `signal` 到 `waitForApproval()`

#### Major: undo/redo 持久化竞态

`onUndo` / `onRedo` 回调中对 storage 的读写是异步且无串行保证。连续快速执行多次 `/undo` 时，`getHistory()` 可能读到同一份旧数据，导致 `redoContentStack` 压入重复消息，`truncateHistory()` 执行顺序不确定。

修复（`src/platforms/console/index.ts`）：

- 新增 `historyMutationQueue`（Promise 链），所有 undo/redo 持久化操作通过 `enqueueHistoryMutation()` 串行入队
- 前一个操作失败不阻塞后续操作

#### Major: redo 栈在会话分叉路径下未清空

`/new`、`/sh`、`/model`、会话加载等路径会导致消息历史分叉，但没有清空 redo 栈。可以在会话 A 中 undo，切到新会话 B，再 redo，把 A 的旧消息写入 B。

修复（`src/platforms/console/App.tsx` + `src/platforms/console/index.ts`）：

- `AppProps` 新增 `onClearRedoStack` 回调，平台层同步清空 `redoContentStack`
- `/new`、`/sh`、`/model`（带参数）、会话加载等所有分叉路径中调用 `clearRedo()` + `onClearRedoStack()`

### 5. CI 构建 & 一键安装

#### 统一构建流水线 `.github/workflows/release.yml`

替换原有的 `release-onboard.yml`，将 Iris 主体和 onboard TUI 合并为一个构建流程，产出单一 tarball。

| Job | Runner | 产物 |
|-----|--------|------|
| `build` (x64) | `ubuntu-latest` | `iris-linux-x64.tar.gz` |
| `build` (arm64) | `ubuntu-24.04-arm` | `iris-linux-arm64.tar.gz` |
| `release` | `ubuntu-latest` | 汇总 → GitHub Release |

每个 tarball 包含：

- `dist/` — TypeScript 编译产物
- `node_modules/` — 含 native addon 的运行时依赖（已清理 `.map`、`test/`、`docs/`）
- `bin/iris-onboard` — 当前架构的 onboard TUI 二进制
- `data/configs.example/` — 配置模板
- `deploy/` — systemd 服务文件、nginx 配置
- `src/platforms/web/web-ui/dist/` — Web 前端构建产物
- `src/prompt/templates/` — 提示词模板

触发条件：push `v*` tag → 全流程；`workflow_dispatch` → 仅构建。

GitHub Free 额度（2000 min/月 Linux runner），本流水线约 5-8 min/次，充裕。

#### 安装脚本改造 `deploy/linux/install.sh`

从「克隆源码 + 现场编译」改为「下载预编译包 + 解压」，并增加 Termux/Android 环境支持。

**环境自适应**：

| 环境 | 判定方式 | 安装目录 | CLI 位置 | systemd |
|------|---------|----------|---------|--------|
| Termux | `$TERMUX_VERSION` / `$HOME/.termux` / `$PREFIX` | `$HOME/iris` | `$PREFIX/bin/iris` | 不安装 |
| Linux root | `id -u == 0` | `/opt/iris` | `/usr/local/bin/iris` | 安装并 enable |
| Linux 非 root | 其他 | `$HOME/iris` | `$HOME/.local/bin/iris` | 不安装 |

**依赖简化**：预编译包模式下不需要 `build-essential`、`python3`、`bun`，只需 `curl` + `git` + `Node.js >= 18`。

**下载与 fallback**：

1. 优先从 GitHub Release 下载对应架构的 tarball
2. 支持 `IRIS_MIRROR` 环境变量设置镜像前缀（如 `https://ghproxy.com/`）
3. 支持 `IRIS_VERSION` 指定版本
4. 下载失败时自动回退到源码构建模式

**用户体验**：

```bash
# 一行命令安装
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash

# 配置
iris onboard

# 启动
iris start
```

### 6. 测试基础设施 + 107 用例

- 引入 vitest@3 作为测试框架
- `package.json` name 改为小写 `iris` 符合 npm 规范

| 测试文件 | 用例数 | 覆盖内容 |
|----------|--------|----------|
| `abort-controller.test.ts` | 33 | scheduler 批次中止、ToolLoop 各阶段中止、`buildAbortResult` 边界、`combineSignals` 降级、并发安全、`waitForApproval` abort 响应及监听清除、scheduler 集成 |
| `format-adapters.test.ts` | 59 | Claude encode/decode/stream（`tool_use` 顺序、ID 唯一性）、OpenAI Compatible/Responses、Gemini `thoughtSignature` 双向映射、跨格式 abort 历史编码安全性 |
| `undo-redo.test.ts` | 15 | performUndo/performRedo 各边界、redo 栈上限截断、clearRedo、交替 undo/redo、大量连续 undo |

## 使用方式

```typescript
// 平台层中止当前会话的 LLM 调用
backend.abortChat(sessionId);
```

## 测试

```
npx vitest run

 ✓ tests/abort-controller.test.ts (33 tests) 484ms
 ✓ tests/format-adapters.test.ts  (59 tests) 8ms
 ✓ tests/undo-redo.test.ts        (15 tests) 4ms

 Test Files  3 passed (3)
      Tests  107 passed (107)
```
