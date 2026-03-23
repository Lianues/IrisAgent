/**
 * 插件命令注册表
 *
 * 让插件可以注册自定义 slash 命令。
 * 平台层在处理用户输入时查询此注册表。
 */

export interface PluginCommand {
  /** 命令名（包含前缀 /，如 "/my-cmd"） */
  name: string;
  /** 命令描述（显示在帮助列表中） */
  description: string;
  /**
   * 命令处理函数。
   * @param args  命令后的参数字符串（如 "/my-cmd foo bar" 中的 "foo bar"）
   * @param context  命令执行上下文
   * @returns 返回字符串时显示给用户；返回 undefined 表示无输出。
   */
  handler: (args: string, context: CommandContext) => Promise<string | undefined> | string | undefined;
}

export interface CommandContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 平台类型（如 'console' / 'web' / 'telegram'） */
  platform: string;
}

export class PluginCommandRegistry {
  private commands = new Map<string, PluginCommand>();

  register(command: PluginCommand): void {
    const name = command.name.startsWith('/') ? command.name : `/${command.name}`;
    this.commands.set(name, { ...command, name });
  }

  unregister(name: string): boolean {
    const key = name.startsWith('/') ? name : `/${name}`;
    return this.commands.delete(key);
  }

  get(name: string): PluginCommand | undefined {
    const key = name.startsWith('/') ? name : `/${name}`;
    return this.commands.get(key);
  }

  has(name: string): boolean {
    const key = name.startsWith('/') ? name : `/${name}`;
    return this.commands.has(key);
  }

  list(): PluginCommand[] {
    return Array.from(this.commands.values());
  }

  /** 尝试匹配并执行插件命令。返回 undefined 表示未匹配。 */
  async tryExecute(input: string, context: CommandContext): Promise<{ matched: true; output?: string } | undefined> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return undefined;

    const spaceIndex = trimmed.indexOf(' ');
    const cmdName = spaceIndex > 0 ? trimmed.slice(0, spaceIndex) : trimmed;
    const args = spaceIndex > 0 ? trimmed.slice(spaceIndex + 1).trim() : '';

    const command = this.commands.get(cmdName);
    if (!command) return undefined;

    const output = await command.handler(args, context);
    return { matched: true, output: output ?? undefined };
  }
}
