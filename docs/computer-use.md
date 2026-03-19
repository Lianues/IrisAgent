# Computer Use

## 概述

让 LLM 通过截屏、鼠标、键盘等操作控制浏览器或桌面，形成「截屏 → 理解 → 操作 → 再截屏」的闭环。

实现方式：将 Gemini Computer Use 的预定义函数作为普通 `ToolDefinition` 注册到 `ToolRegistry`，走标准 function calling 路径。不依赖任何特定模型的内置 Computer Use 能力，任何支持工具调用的模型均可使用。

支持两种执行环境：

| 环境 | 说明 | 截图范围 | 操作范围 |
|---|---|---|---|
| `browser` | Playwright 控制 Chromium 浏览器 | 浏览器视口 | 仅浏览器内 |
| `screen` | 系统级截屏 + 输入模拟（全屏模式） | 整个桌面 | 任意应用 |
| `screen` + `targetWindow` | 系统级截屏 + 输入模拟（窗口模式） | 指定窗口区域 | 仅指定窗口 |

## 文件结构

```
src/computer-use/
├── index.ts              模块入口（导出公共 API）
├── types.ts              Computer 抽象接口 + EnvState 类型
├── coordinator.ts        坐标反归一化（0-999 ↔ 实际像素）
├── tools.ts              13 个预定义函数的工具声明 + handler
│
│   ── browser 环境 ──
├── browser-env.ts        浏览器环境（IPC 客户端，与 sidecar 通信）
├── browser-sidecar.ts    Playwright 子进程（独立 Node.js 进程）
│
│   ── screen 环境 ──
├── screen-env.ts         桌面环境（IPC 客户端，与 sidecar 通信）
├── screen-sidecar.ts     系统操作子进程（独立 Node.js 进程）
└── screen/
    ├── adapter.ts        ScreenAdapter 平台抽象接口
    ├── index.ts          平台适配器注册中心（自动检测当前 OS）
    └── windows.ts        Windows 实现（PowerShell + .NET API）
```

## 架构

### Sidecar 进程模型

browser 和 screen 环境均采用相同的 Sidecar 进程模型。实际的浏览器控制或系统操作运行在独立 Node.js 子进程中，主进程通过 stdin/stdout NDJSON 通信：

```
主进程 (Bun / Node.js)                     Sidecar 子进程 (Node.js)
┌──────────────────┐                       ┌──────────────────────────┐
│ bootstrap.ts     │                       │                          │
│                  │── spawn node ────────▶│  browser-sidecar.ts     │ browser-env.ts   │◄── stdout NDJSON ────│    Playwright + Chromium  │
│   (IPC 客户端)   │─── stdin NDJSON ────▶│                          │
│                  │                       ├──────────────────────────┤
│       或         │── spawn node ────────▶│  screen-sidecar.ts       │
│ screen-env.ts    │◄── stdout NDJSON ────│    ScreenAdapter          │
│   (IPC 客户端)   │─── stdin NDJSON ────▶│    (Windows / macOS / …)  │
│                  │                       │                          │
│ tools.ts         │                       │  截屏 → base64           │
│ scheduler        │                       │  点击 / 输入 / 滚动      │
│ tool-loop        │                       │                          │
└──────────────────┘                       └──────────────────────────┘
```

- 主进程无论跑在 Bun 还是 Node.js 都不受影响
- sidecar 始终通过 `node --import tsx` 启动，确保 Playwright 的兼容性
- 主进程退出时 stdin 关闭，sidecar 自动检测并清理退出

### screen 环境平台适配

screen 环境通过 `ScreenAdapter` 接口抽象平台差异。每个操作系统提供一个实现：

```
screen/
├── adapter.ts        接口定义
├── index.ts          注册中心：getScreenAdapter() 自动选择当前 OS 的实现
├── windows.ts        Windows：PowerShell + .NET System.Windows.Forms / user32.dll
├── (macos.ts)        macOS：计划中（screencapture + cliclick / CGEvent）
└── (linux.ts)        Linux：计划中（scrot/gnome-screenshot + xdotool/ydotool）
```

新增平台只需：
1. 创建 `screen/<platform>.ts`，实现 `ScreenAdapter` 接口
2. 在 `screen/index.ts` 的 `adapters` 数组中注册

### IPC 协议

每行一条 JSON，换行分隔（NDJSON）。

请求（主进程 → sidecar）：

```json
{ "id": 1, "method": "clickAt", "params": { "x": 720, "y": 450 } }
```

响应（sidecar → 主进程）：

```json
{ "id": 1, "result": { "screenshot": "<base64 PNG>", "url": "https://..." } }
```

错误响应：

```json
{ "id": 1, "error": "Timeout waiting for navigation" }
```

## 类型定义

### Computer 接口（`types.ts`）

所有执行环境实现此接口。坐标参数为反归一化后的实际像素值（转换由 tools 层完成）。

```typescript
interface Computer {
  screenSize(): [number, number];
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  currentState(): Promise<EnvState>;

  // 浏览器导航
  openWebBrowser(): Promise<EnvState>;
  goBack(): Promise<EnvState>;
  goForward(): Promise<EnvState>;
  search(): Promise<EnvState>;
  navigate(url: string): Promise<EnvState>;

  // 鼠标
  clickAt(x: number, y: number): Promise<EnvState>;
  hoverAt(x: number, y: number): Promise<EnvState>;
  dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<EnvState>;

  // 键盘
  typeTextAt(x: number, y: number, text: string, pressEnter: boolean, clearBeforeTyping: boolean): Promise<EnvState>;
  keyCombination(keys: string[]): Promise<EnvState>;

  // 滚动
  scrollDocument(direction: 'up' | 'down' | 'left' | 'right'): Promise<EnvState>;
  scrollAt(x: number, y: number, direction: string, magnitude: number): Promise<EnvState>;

  // 等待
  wait5Seconds(): Promise<EnvState>;
}
```

### EnvState

每次操作后返回的环境状态：

```typescript
interface EnvState {
  screenshot: Buffer;  // PNG 截屏字节
  url: string;         // 当前页面 URL
}
```

## 坐标系

LLM 输出的坐标为 **0-999 归一化值**，与屏幕分辨率无关。

转换公式：

```
实际像素 X = Math.round(normalized_x / 1000 * screenWidth)
实际像素 Y = Math.round(normalized_y / 1000 * screenHeight)
```

坐标转换在 `tools.ts` 的 handler 中完成，`Computer` 接口接收的始终是实际像素值。`scroll_at` 的 `magnitude` 参数同样是归一化值，需按方向分别使用 `denormalizeX` 或 `denormalizeY`。

## 工具列表

以下 13 个工具在 `computer_use.yaml` 的 `enabled: true` 时注册到 `ToolRegistry`。

| 工具名 | 参数 | 说明 |
|---|---|---|
| `open_web_browser` | 无 | 返回当前屏幕截图 |
| `go_back` | 无 | 浏览器后退 |
| `go_forward` | 无 | 浏览器前进 |
| `search` | 无 | 导航到搜索引擎首页 |
| `navigate` | `url` | 导航到指定 URL |
| `wait_5_seconds` | 无 | 等待 5 秒 |
| `click_at` | `x`, `y` | 点击 |
| `hover_at` | `x`, `y` | 悬停 |
| `drag_and_drop` | `x`, `y`, `destination_x`, `destination_y` | 拖放 |
| `type_text_at` | `x`, `y`, `text`, `press_enter?`, `clear_before_typing?` | 在指定位置输入文本 |
| `key_combination` | `keys` | 按键组合，如 `"Control+C"` |
| `scroll_document` | `direction` | 滚动整个页面 |
| `scroll_at` | `x`, `y`, `direction`, `magnitude?` | 在指定位置滚动 |

所有坐标参数均为 0-999 归一化值。每个工具执行后自动截屏，截图通过 `functionResponse.parts`（`InlineDataPart[]`）回传给模型。

## 截图回传机制

工具 handler 返回约定格式：

```typescript
{
  __response: { url: "https://..." },
  __parts: [{ inlineData: { mimeType: "image/png", data: "<base64>" } }]
}
```

`scheduler.ts` 识别 `__response` / `__parts` 字段后拆分：

- `__response` → `functionResponse.response`
- `__parts` → `functionResponse.parts`（`InlineDataPart[]`）

这是一个通用机制，不限于 Computer Use。任何工具都可以通过 `__parts` 返回多模态内联数据（截图、音频等）。`InlineDataPart` 的 `mimeType` 为 `string`，支持图片、音频、视频等任意 MIME 类型。

## 配置

### `computer_use.yaml`

```yaml
enabled: false
environment: browser
screenWidth: 1440
screenHeight: 900
initialUrl: https://www.google.com
headless: false
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `false` | 是否启用 |
| `environment` | `browser \| screen` | `browser` | 执行环境 |
| `excludedFunctions` | `string[]` | — | 排除的预定义函数名 |
| `initialUrl` | `string` | `https://www.google.com` | 启动时打开的页面 |
| `searchEngineUrl` | `string` | `https://www.google.com` | search 工具的目标 |
| `maxRecentScreenshots` | `number` | `3` | 发送给 LLM 时保留截图的最近轮次数 |

**browser 环境专用字段：**

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `screenWidth` | `number` | `1440` | 视口宽度（像素） |
| `screenHeight` | `number` | `900` | 视口高度（像素） |
| `headless` | `boolean` | `false` | 是否无头模式 |
| `highlightMouse` | `boolean` | `false` | 是否在操作位置显示红色圆圈 |

**screen 环境专用字段：**

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `targetWindow` | `string` | — | 目标窗口标题（子串匹配），设置后进入窗口模式 |

屏幕尺寸自动检测，无需配置 `screenWidth` / `screenHeight`。

#### 窗口模式

设置 `targetWindow` 后，screen 环境的行为变化：

| 行为 | 全屏模式 | 窗口模式 |
|---|---|---|
| 截屏范围 | 整个桌面 | 目标窗口区域 |
| `screenSize` | 屏幕分辨率 | 窗口尺寸 |
| 坐标基准 | 屏幕左上角 | 窗口左上角 |
| 操作前 | 无特殊处理 | 自动激活窗口（`SetForegroundWindow`） |

窗口标题按子串匹配。如果多个窗口匹配，使用第一个找到的可见窗口。
如果目标窗口被最小化，操作前会自动恢复（`ShowWindow SW_RESTORE`）。

### `tools.yaml` 审批策略

Computer Use 工具遵循标准的工具审批配置：

```yaml
# 只读 / 低风险操作
click_at:
  autoApprove: true
scroll_document:
  autoApprove: true
navigate:
  autoApprove: true

# 输入类操作
type_text_at:
  autoApprove: true
key_combination:
  autoApprove: false    # 可能触发系统级操作
```

未配置的工具默认需要手动确认。

## 依赖

**browser 环境：**

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| `playwright` | 浏览器自动化 | `npm install playwright` |
| Chromium 浏览器 | Playwright 控制的浏览器实例 | `npx playwright install chromium` |

**screen 环境：**

- Windows：无额外依赖，通过 PowerShell 调用 .NET API（System.Windows.Forms / user32.dll）
- macOS / Linux：待实现

未满足依赖时，Computer Use 初始化会失败并给出提示，不会阻塞其他功能启动。

## 截图清理

每张 Computer Use 截图约占数千 token。长时间操作后历史中会积累大量截图，导致 token 浪费和上下文溢出。

`maxRecentScreenshots` 控制发送给 LLM 时保留截图的最近轮次数。处理逻辑与 Gemini 官方示例一致：

1. 在 `prepareHistoryForLLM` 之后，调用 `stripOldScreenshots`，从历史末尾向前扫描
2. 只看 `role: 'user'` 的消息（工具响应所在的位置）
3. 检查该消息的 parts 中是否存在 `functionResponse.name ∈ COMPUTER_USE_FUNCTION_NAMES` 且 `functionResponse.parts` 非空的 part
4. 如果有，该消息算一个「含截图轮次」，计数加一
5. 计数超出 `maxRecentScreenshots` 后，把该消息中所有 CU 工具响应的 `functionResponse.parts` 置为 `undefined`
6. `functionResponse.response`（URL 等文本信息）始终保留，不受影响

### 什么是「一轮」

tool-loop 中，LLM 一次输出的所有 functionCall 的响应会合并到同一个 `{ role: 'user', parts: [...] }` 消息里。因此：

- **一轮 LLM 调用输出多个 CU 工具（如同时 click + type），它们的截图在同一个 user 消息中，算一轮**
- 不包含 CU 截图的 user 消息（如纯文本工具响应、用户输入）不参与计数，直接跳过

### 示例

假设 `maxRecentScreenshots: 2`，历史中有 5 个含 CU 截图的 user 消息：

```
user: [click_at 截图]               ← screenshotTurns=5 > 2, 剥离
model: ...
user: [type_text_at 截图, navigate 截图]  ← screenshotTurns=4 > 2, 剥离（整轮所有 CU 截图）
model: ...
user: [read_file 结果]                    ← 无 CU 截图, 跳过, 不计数
model: ...
user: [scroll_document 截图]              ← screenshotTurns=3 > 2, 剥离
model: ...
user: [click_at 截图]                     ← screenshotTurns=2, 保留
model: ...
user: [navigate 截图]                     ← screenshotTurns=1, 保留
```

### 处理位置

清理在 `backend.ts` 的 `prepareHistoryForLLM` → `stripOldScreenshots` 中完成。这个时机保证：

- **不动存储**：存储中始终保留完整截图，清理只在发给 LLM 前进行
- **每次 LLM 调用前都会重新执行**：随着历史增长，早期的截图会逐步被剥离
- **仅影响 CU 工具**：只清理 `COMPUTER_USE_FUNCTION_NAMES` 集合中的工具响应，其他工具的 `functionResponse.parts` 不受影响

### 配置

| 值 | 效果 |
|---|---|
| `3`（默认） | 保留最近 3 轮含 CU 截图的工具响应，与 Gemini 官方示例一致 |
| `0` | 不保留任何截图，所有 CU 截图在发给 LLM 前都会被剥离 |
| `Infinity` | 全部保留，不做任何清理 |
| 不设置 | 使用默认值 3 |

## 启动流程

`bootstrap.ts` 中的初始化逻辑：

```typescript
if (config.computerUse?.enabled) {
  try {
    const { BrowserEnvironment, ScreenEnvironment, createComputerUseTools } = await import('./computer-use');
    let computerEnv;
    if (env === 'screen') {
      computerEnv = new ScreenEnvironment({ ... });
    } else {
      computerEnv = new BrowserEnvironment({ ... });
    }
    await computerEnv.initialize();    // 启动对应的 sidecar 子进程
    tools.registerAll(createComputerUseTools(computerEnv, config.computerUse.excludedFunctions));
  } catch (err) {
    console.error('[Iris] Computer Use 初始化失败:', err);
    console.error('[Iris] 已跳过 Computer Use，其余功能正常启动。');
  }
}
```

初始化失败时不阻塞启动，其余功能正常运行。

## 后续计划

| 阶段 | 内容 |
|---|---|
| Phase 1（已完成） | 浏览器环境 + Sidecar 进程模型 + 13 个预定义工具 |
| Phase 2（已完成） | 桌面环境（`screen`）：Windows 平台 + ScreenAdapter 模块化架构 |
| Phase 2.x | screen 环境：macOS 和 Linux 平台适配器 |
| Phase 3 | 其他 LLM 格式适配（Claude Computer Use、OpenAI 兼容方案） |
