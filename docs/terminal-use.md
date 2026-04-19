# Terminal Use

## 概述

Terminal Use 让 LLM 通过一个持久化的无头终端会话执行命令、查看当前终端页面文本、输入字符、发送按键并浏览 scrollback。

它与 Computer Use 的区别是：

- Computer Use 返回截图
- Terminal Use 返回**当前终端可见页面的文本快照**

适合：

- `git status` / `pytest` / `npm run` / `python script.py`
- `python` / `node` REPL
- `less` / `top` / `vim` 等交互式终端程序

## 架构

Terminal Use 复用 Computer Use 的 sidecar 模式：

```text
主进程工具 handler
  -> terminal-env.ts
    -> spawn node sidecar
      -> terminal-sidecar.ts
        -> node-pty
        -> @xterm/headless buffer
```

Sidecar 内部维护两部分状态：

1. **真实 PTY 会话**：负责运行 shell 和交互程序
2. **headless terminal buffer**：负责把 ANSI / 光标移动 / 清屏 / alt screen 渲染成当前“可见页面文本”

## 工具列表

启用 `terminal_use.yaml` 后会注册以下工具：

- `get_terminal_snapshot`
- `restart_terminal`
- `exec_terminal_command`
- `type_terminal_text`
- `press_terminal_key`
- `scroll_terminal`
- `wait_terminal`
- `interrupt_terminal`

## 关键行为

### 1. 持久会话

同一轮后的工具调用共享一个终端：

- cwd 会保留
- 环境变量会保留
- 已进入的 REPL / TUI 会保留

如果终端进入异常状态、前台程序卡住、或你想放弃当前会话上下文重新开始，可以调用 `restart_terminal`：

- 它会销毁旧 PTY 会话
- 重新拉起一个全新的 shell
- 返回新会话的初始页面文本

注意：这会丢失当前终端中的未保存状态。

### 2. 页面快照

每次操作后返回：

- `screen`：当前可见终端页面文本（主观察对象）
- `meta.rows / cols`
- `meta.cursorRow / cursorCol`
- `meta.cwd`
- `meta.promptReady`
- `meta.scrollback.offset / maxOffset`
- `commandOutput`：`exec_terminal_command` 的完整输出（超长截断）

也就是说，Terminal Use 的返回是“**屏幕字符串为主，结构化元信息为辅**”，
这样既保留了终端页面原貌，又能给模型提供难以从纯文本里稳定推断的辅助状态。

### 3. 命令完成检测

`exec_terminal_command` 在 shell 中插入一个隐藏的 OSC 标记，用来判断：

- 命令是否回到 prompt
- exitCode 是多少
- 当前 cwd 是什么

这些标记由 shell 的 prompt hook 自动发出，并在 sidecar 内部被剥离，
**不会作为可见终端文本暴露给 AI**。

- bash：通过 `PROMPT_COMMAND` 注入
- PowerShell：通过自定义 `prompt` 函数注入
- zsh：通过隔离的 `precmd` hook 注入（当显式使用 zsh 时）

如果超时仍未回到 prompt，会返回当前页面并标记 `timedOut: true`，后续可继续：

- `wait_terminal`
- `press_terminal_key`
- `type_terminal_text`
- `interrupt_terminal`

### 4. 安全策略

`exec_terminal_command` 走扩展自身的命令安全流程：

- 静态黑名单：直接拒绝
- 静态白名单：直接放行
- AI 分类器：不确定命令交给模型判定
- 必要时通过 scheduler 请求用户确认

而 `get_terminal_snapshot` / `scroll_terminal` / `wait_terminal` / `type_terminal_text` / `press_terminal_key` / `interrupt_terminal` / `restart_terminal` 的默认审批，也由 terminal-use 自己的配置贡献管理。

## 配置来源

terminal-use 不再要求把自己的默认配置硬编码进宿主应用的 `data/configs.example/*.yaml` 或 `tools.yaml` 模板中。

它通过 Extension SDK 的 **Config Contribution** 自行注册两组配置：

- `terminal_use`：终端会话配置（cwd、rows、cols、timeout 等）
- `terminal_use_tools`：terminal-use 工具自己的审批与分类器配置

平台侧可通过 `api.configContributions.getAll()` 统一读取并渲染这些配置。

## 配置

### `terminal_use.yaml`

```yaml
enabled: false
cols: 120
rows: 32
scrollback: 5000
startupTimeoutMs: 10000
defaultCommandTimeoutMs: 30000
defaultWaitTimeoutMs: 10000
idleQuietMs: 350
maxDisplayChars: 12000
maxCommandOutputChars: 50000
maxRecentSnapshots: 3
```

## 注意事项

- `scroll_terminal` 只改变“查看视图”，不会向程序发送 `PageUp/PageDown`
- 如果要真的给程序发送按键，请用 `press_terminal_key`
- `type_terminal_text` 是低级输入能力，风险高于 `exec_terminal_command`
- `interrupt_terminal` 发送的是 `Ctrl+C`
- `restart_terminal` 会丢失当前 terminal 会话状态，建议仅在需要“重开终端”时使用
