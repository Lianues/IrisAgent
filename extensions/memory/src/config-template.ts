export const DEFAULT_CONFIG_TEMPLATE = `# 记忆插件配置
#
# 启用后，LLM 可通过 memory_search / memory_add / memory_update / memory_delete 工具
# 读写长期记忆，实现跨会话的信息持久化。
#
# 当前存储实现使用文件型 MemoryStore（保留 memory.db 文件名以兼容旧配置）。
# 默认主记忆文件存放在 memory extension 数据目录下的 memory.db。

# 是否启用主记忆
# 注意：即使主记忆 disabled，memory.spaces service 仍可为其他 extension 提供独立记忆空间。
enabled: false

# 指定记忆系统内部调用使用的模型（如提取、归纳、检索）。
# 不填则默认使用当前活动模型。
# model: gpt-4o-mini

# 主记忆数据库路径（相对于 memory extension 数据目录，或绝对路径）
# dbPath: ./memory.db

# ── 自动提取（对话结束后自动从对话中提取值得记住的信息）──
autoExtract: true
# 每 N 轮对话后提取一次
extractInterval: 1

# ── 智能检索（每轮对话前自动注入相关记忆到上下文）──
autoRecall: true
# 每轮注入记忆的最大大小（bytes）
maxContextBytes: 20480
# 会话级记忆注入总上限（bytes）
sessionBudgetBytes: 61440

# ── 跨会话归纳（定期整理合并冗余记忆）──
consolidation:
  enabled: true
  # 两次归纳之间的最小间隔（小时）
  minHours: 24
  # 触发归纳的最少新会话数
  minSessions: 3

# ── 命名记忆空间 ─────────────────────────────────────
# 用于需要独立记忆域的 extension，例如 virtual-lover。
# 每个 space 使用独立存储文件，与主记忆互不污染；dream/consolidation 也可单独执行。
spaces:
  virtual-lover:
    enabled: true
    dbPath: spaces/virtual-lover/memory.db
    # 不填则继承顶层 model
    model: ''
    maxContextBytes: 20480
    smallSetThreshold: 15
    consolidation:
      enabled: true
      minHours: 24
      minSessions: 3
`;
