/**
 * SillyTavern 插件配置类型
 */
export interface SillyTavernConfig {
  /** 是否启用（覆盖 Iris 默认提示词） */
  enabled: boolean;

  /** 当前激活的预设文件名（presets/ 目录下） */
  preset: string;

  /** 当前激活的角色卡文件名（characters/ 目录下，可为空） */
  character: string;

  /** 全局世界书文件名列表（worldbooks/ 目录下） */
  worldbooks: string[];

  /** 全局正则脚本文件名列表（regex/ 目录下） */
  regex: string[];

  /** 宏变量 */
  macros: Record<string, string>;

  /** 将组装结果写入日志 */
  debug: boolean;
}
