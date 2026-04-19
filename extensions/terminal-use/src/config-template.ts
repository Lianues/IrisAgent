export const DEFAULT_CONFIG_TEMPLATE = `# terminal-use 配置
#
# 启用后，LLM 可操作一个持久化的无头终端会话。
# 每次操作后返回当前终端可见页面文本，而不是截图。
# 适合执行命令、查看输出、操作 REPL / TUI / 交互式程序。
#
# 说明：
#   - Windows 默认优先启动 pwsh / powershell
#   - Linux/macOS 默认优先使用 bash（便于稳定注入 prompt hook）
#   - 如显式指定 /bin/zsh，terminal-use 会为 zsh 注入隔离的 precmd hook
#   - 终端会话保持状态：cwd、环境变量、交互程序都会持续保留
#   - 工具审批与分类器设置位于 terminal_use_tools.yaml

# 是否启用
enabled: false

# 启动目录（相对路径基于项目根目录）
# cwd: .

# 指定 shell 可执行路径；不填则自动选择当前平台默认 shell
# 例如：
#   shell: C:\\Program Files\\PowerShell\\7\\pwsh.exe
#   shell: /bin/zsh
# shell:

# 终端尺寸
cols: 120
rows: 32

# scrollback 行数
scrollback: 5000

# 启动终端后等待首屏稳定的超时（ms）
startupTimeoutMs: 10000

# exec_terminal_command 默认超时（ms）
defaultCommandTimeoutMs: 30000

# wait_terminal 默认最长等待时间（ms）
defaultWaitTimeoutMs: 10000

# 判定“终端空闲”的静默窗口（ms）
idleQuietMs: 350

# 单次返回 display 的最大字符数（超出时中间截断）
maxDisplayChars: 12000

# 单次返回完整命令输出的最大字符数（超出时中间截断）
maxCommandOutputChars: 50000

# 发送给 LLM 时，仅保留最近 N 轮 terminal-use 的大文本快照。
# 更早的 display / output / commandOutput 会被自动剥离，以节省 token。
maxRecentSnapshots: 3
`;

export const DEFAULT_TOOLS_CONFIG_TEMPLATE = `# terminal-use 工具配置
#
# 这些配置由 terminal-use 扩展自己消费，
# 不依赖宿主应用的 tools.yaml 默认模板。

getTerminalSnapshotAutoApprove: true
restartTerminalAutoApprove: false

execTerminalCommandClassifier:
  enabled: true
  confidenceThreshold: 0.8
  fallbackPolicy: deny
  timeout: 8000

typeTerminalTextAutoApprove: false
pressTerminalKeyAutoApprove: false
scrollTerminalAutoApprove: true
waitTerminalAutoApprove: true
interruptTerminalAutoApprove: false
`;
