/**
 * 子代理类型定义与注册表
 *
 * 定义可用的子代理类型（系统提示词、工具白/黑名单、模型名称等），
 * 主 LLM 通过 sub_agent 工具按类型派生子代理。
 */

/** 子代理类型配置 */
export interface SubAgentTypeConfig {
  /** 类型标识 */
  name: string;
  /** 面向父级 LLM 的用途说明（展示在 sub_agent 工具声明中） */
  description: string;
  /** 子代理的系统提示词 */
  systemPrompt: string;
  /** 工具白名单（与 excludedTools 互斥，优先） */
  allowedTools?: string[];
  /** 工具黑名单 */
  excludedTools?: string[];
  /** 固定使用的模型名称；不填时跟随当前活动模型 */
  modelName?: string;
  /** 当前类型的 sub_agent 调用是否可按 parallel 工具参与调度 */
  parallel: boolean;
  /** 最大工具轮次 */
  maxToolRounds: number;
  /** 此类型是否使用流式输出（已解析全局覆盖后的最终值） */
  stream: boolean;
  /** 是否默认后台运行；调用参数 run_in_background 显式传入时优先 */
  background?: boolean;
}

/** 异步子代理是否启用的标志 */
export type AsyncSubAgentCapability = boolean;
/** 子代理类型注册表 */
export class SubAgentTypeRegistry {
  private types = new Map<string, SubAgentTypeConfig>();

  /** 注册子代理类型 */
  register(config: SubAgentTypeConfig): void {
    this.types.set(config.name, config);
  }

  /** 获取子代理类型配置 */
  get(name: string): SubAgentTypeConfig | undefined {
    return this.types.get(name);
  }

  /** 列出所有已注册的类型名称 */
  list(): string[] {
    return Array.from(this.types.keys());
  }

  /** 获取所有已注册的类型配置 */
  getAll(): SubAgentTypeConfig[] {
    return Array.from(this.types.values());
  }
}
