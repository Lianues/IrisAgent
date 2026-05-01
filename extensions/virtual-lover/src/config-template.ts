export const defaultConfigTemplate = `# Virtual Lover Iris extension
#
# 这是 Iris 原生重构版配置，不兼容也不复刻 OpenClaw 的 agents/channels/bindings/gateway 模型。
# 插件与 Iris 本体保持解耦：只通过公开 extension SDK、hook、route、service 交互。
#
# 记忆策略：lover 记忆与主记忆分离，但仍由 Iris memory extension 提供底座。
# virtual-lover 只引用 memory.spaces 中的 virtual-lover space，不自建存储/检索/dream。
# 请确保 memory extension 已启用/加载，并在 memory.yaml 的 spaces.virtual-lover 中配置独立空间。

# 默认关闭 prompt 注入，避免 extension 被自动发现后改变 Iris 本体行为。
# 需要启用伴侣上下文时手动改为 true。
enabled: false

agent:
  # MVP 先以单 Agent 为主；后续多 Agent 会引入 uiOwner 等策略。
  mode: single
  defaultAgentId: default

prompt:
  enabled: true
  # prepend: 在 Iris 原系统提示词前追加伴侣上下文；replace: 完全替换系统提示词。
  injectionMode: prepend
  priority: 300
  onlyFirstRound: true
  useAntml: true
  sections:
    - persona
    - style
    - rules
    - lover_memory

memory:
  # Iris memory extension 中的命名 memory space。
  # lover 记忆会与主记忆分离维护，并可单独 dream。
  space: virtual-lover
  autoInject: true
  maxRecallBytes: 12000
  # 对话结束后自动从最近互动中提取 lover 专属记忆，写入上方独立 memory space。
  autoExtract: true
  # 每 N 轮对话后提取一次。
  extractInterval: 1
  tools:
    enabled: true

proactive:
  # MVP 只支持手动通过 Web/API 触发，不包含定时 scheduler。
  enabled: false
  # 推荐使用 delivery.yaml 中的 binding；为空时回退到 platform + target。
  binding: ''
  # 可选 delivery policy id，用于 cooldown / maxPerDay / quietHours 等通用门控。
  policy: ''
  platform: telegram
  target:
    # Telegram 私聊/群聊均使用 chat；id 填 Telegram chat_id。
    kind: chat
    id: ''
    # Telegram 话题/Forum topic 可填写 threadId；不用则留空。
    threadId: ''
  generation:
    enabled: true
    maxOutputTokens: 240
    temperature: 0.8
    instruction: |
      请基于伴侣人设、说话风格、相处边界、可用记忆和环境上下文，生成一条自然、简短、不过度打扰的主动消息。
      只输出要发送给用户的消息正文，不要解释。
      消息应低压力、可忽略，不要求用户立刻回复。
  strategies:
    goodMorning:
      enabled: false
      schedule: '0 8 * * *'
      reason: 早晨轻声问候，给用户一个稳定、温柔、不要求立刻回应的开始。
      urgent: false
    goodnight:
      enabled: false
      schedule: '0 23 * * *'
      reason: 睡前发送一条简短、安静、温柔的晚安消息，帮助用户放松下来。
      urgent: false
    dailyCheckIn:
      enabled: false
      schedule: '0 20 * * *'
      reason: 每天固定时间轻轻关心一下用户今天的状态，不追问、不制造压力。
      urgent: false
    random:
      enabled: false
      windowStart: '10:00'
      windowEnd: '22:00'
      minPerDay: 0
      maxPerDay: 2
      reason: 在合适时段发送一条像自然想起用户一样的轻柔问候，短一点，不打扰。
    lateNight:
      enabled: false
      schedule: '0 1 * * *'
      reason: 深夜用克制、温柔的方式提醒用户照顾自己和休息，不责备、不催促。
      urgent: true
    memory:
      enabled: false
      schedule: '0 21 * * *'
      query: relationship milestones, important dates, recent emotional needs, user preferences
      reason: 参考伴侣专属记忆中的偏好、重要日期或近期情绪线索，发送一条自然、不突兀的关心。
      urgent: false
    weather:
      enabled: false
      schedule: '0 8 * * *'
      reason: 结合天气或环境上下文，给出一句自然、有用、不过度打扰的关心或提醒。
      urgent: false
  followup:
    enabled: true
    # 默认在 3 小时后做后续关心。
    # followup/deferredReply 由工具或 /lover action 创建 once scheduler job；
    # 不在 virtual-lover 内部维护私有 scheduler。
    defaultDelayMinutes: 180
    dedupeHours: 24
  deferredReply:
    enabled: true
    defaultDelayMinutes: 30

web:
  enabled: true
  basePath: /api/ext/virtual-lover
  panelPath: /virtual-lover
`;
