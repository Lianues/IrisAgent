/**
 * tools.ts —— 注册 switch_environment 工具
 *
 * 工具描述里动态列出当前所有可用环境（local + 所有 Host），
 * AI 调用 switch_environment({name: 'cqa1'}) 即可把后续所有工具切到该远端。
 */

import type { ToolDefinition } from 'irises-extension-sdk';
import type { EnvironmentManager } from './environment.js';

export function buildSwitchEnvironmentTool(envMgr: EnvironmentManager): ToolDefinition {
  // 描述在每次 LLM 调用时由 declaration getter 动态生成？不行 —— ToolDefinition 是静态对象。
  // 解决方式：description 在注册时构建一次；当服务器列表变化时，由 wrap 层 unregister + 重新 register。
  const envs = envMgr.listEnvs();
  const envNames = envs.map(e => e.name);
  const lines: string[] = [];
  lines.push('切换"远程执行环境"。切换后，list_files / read_file / write_file / shell 等工具会自动在该环境上执行（远端 SSH / 本地）。');
  lines.push('如果用户明确指定了环境名，必须把该环境名放入 name 参数；例如 switch_environment({"name":"server1"})。');
  lines.push('');
  lines.push('当前可用环境：');
  for (const e of envs) {
    const tags = [
      e.isLocal ? '本地' : `${e.user ?? '?'}@${e.hostName ?? '?'}`,
      e.os ? `OS=${e.os}` : null,
      e.workdir ? `workdir=${e.workdir}` : null,
      e.description ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`  - ${e.name}: ${tags}`);
  }
  lines.push('');
  lines.push('注意：当前环境会在调用本工具后切换；工具返回值会告诉你切换后的 current。');

  return {
    declaration: {
      name: 'switch_environment',
      description: lines.join('\n'),
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `要切换到的环境名（local 表示本机）。可选值：${envNames.join(' | ')}`,
            enum: envNames,
          },
        },
        required: ['name'],
      },
    },
    handler: async (args) => {
      const name = (args.name as string | undefined)?.trim();
      if (!name) throw new Error('switch_environment: name 不能为空');
      const { previous, current } = envMgr.setActive(name);
      const after = envMgr.listEnvs().find(e => e.name === current);
      return {
        success: true,
        previous,
        current,
        environment: after,
        message:
          previous === current
            ? `已经在环境 "${current}"，未发生变化。`
            : `已从 "${previous}" 切换到 "${current}"。后续工具调用将自动在此环境执行。`,
      };
    },
  };
}
