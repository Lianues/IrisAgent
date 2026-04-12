/**
 * 默认配置模板
 *
 * 通过 ctx.ensureConfigFile() 在首次运行时释放到用户配置目录。
 */
export const defaultConfigTemplate = `# ─────────────────────────────────────────────
# SillyTavern 提示词引擎配置
# ─────────────────────────────────────────────
#
# 数据目录位于 ~/.iris/extension-data/sillytavern/
# 请将酒馆导出的 JSON 文件放入对应子目录：
#   presets/       预设文件
#   characters/    角色卡文件
#   worldbooks/    世界书文件
#   regex/         正则脚本文件

sillytavern:
  # 是否启用（启用后将接管 Iris 默认的提示词组装）
  enabled: false

  # 当前激活的预设文件名（presets/ 目录下）
  preset: ""

  # 当前激活的角色卡文件名（characters/ 目录下，留空则不使用）
  character: ""

  # 全局世界书文件名列表（worldbooks/ 目录下）
  worldbooks: []

  # 全局正则脚本文件名列表（regex/ 目录下）
  regex: []

  # 宏变量（对应酒馆的 {{user}}、{{char}} 等）
  # char 会从角色卡自动提取，一般只需设置 user
  macros:
    user: "User"

  # 调试模式：将组装后的提示词结构输出到日志
  debug: true
`;
