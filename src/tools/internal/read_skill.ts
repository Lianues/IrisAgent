/**
 * Skill 读取工具
 *
 * 参考 Claude Code 的 Agent Skills 设计：
 * - 工具声明中只暴露 Skill 摘要（name / path / description）
 * - 模型需要完整 Skill 内容时，再调用本工具按需读取
 *
 * 这样可以避免把 Skill 全文持续拼接到每一轮用户消息，减少重复 token 消耗。
 */

import * as path from 'path';
import type { ToolDefinition, FunctionDeclaration } from '../../types';
import type { Backend } from '../../core/backend';

export interface ReadSkillDeps {
  getBackend: () => Backend;
}

interface ListedSkill {
  name: string;
  path: string;
  description?: string;
}

/**
 * 将任意文本安全地编码为 YAML 双引号字符串。
 *
 * 说明：这里复用 JSON.stringify 的转义结果，因为 YAML 兼容 JSON 风格的双引号字符串，
 * 能避免 Windows 路径中的反斜杠、冒号和 description 中的特殊字符破坏 YAML 结构。
 */
function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * 构建可嵌入工具描述中的 YAML Skill 列表。
 *
 * 模型在查看工具描述时，只需要看到每个 Skill 的最小必要摘要，
 * 需要全文时再调用 read_skill(path) 获取。
 */
function buildYamlSkillList(skills: ListedSkill[]): string {
  if (skills.length === 0) return '[]';

  return skills.map((skill) => {
    const lines = [
      `- name: ${toYamlQuoted(skill.name)}`,
      `  path: ${toYamlQuoted(skill.path)}`,
    ];

    if (skill.description) {
      lines.push(`  description: ${toYamlQuoted(skill.description)}`);
    }

    return lines.join('\n');
  }).join('\n');
}

/**
 * 根据当前 Skill 列表构建 read_skill 工具声明。
 *
 * 这里把 path 设计为唯一标识：
 * - 文件系统 Skill 使用真实的 SKILL.md 绝对路径
 * - 内联 Skill 使用 inline:<name> 形式的稳定标识
 *
 * 这样模型既能唯一定位 Skill，也能在文件系统 Skill 中知道配套脚本所在目录。
 */
function buildDeclaration(skills: ListedSkill[]): FunctionDeclaration {
  const yamlList = buildYamlSkillList(skills);

  return {
    name: 'read_skill',
    description:
      'Read the full content of a skill by its path identifier. ' +
      'For filesystem skills, use the SKILL.md absolute path shown below. ' +
      'For inline skills, use the inline:* identifier exactly as listed.\n\n' +
      'Skills are user-defined knowledge modules that provide specialized instructions. ' +
      'Only load a skill when it is relevant to the current task.\n\n' +
      'Available skills (YAML):\n' +
      `${yamlList}`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Skill path identifier. Use the exact path value shown in the available skill list.',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * 计算 Skill 的资源根目录。
 *
 * - 文件系统 Skill：返回 SKILL.md 所在目录，供模型继续访问 scripts/、references/ 等资源
 * - 内联 Skill：返回 undefined，明确告知没有配套目录资源
 */
function getSkillBasePath(skillPath: string): string | undefined {
  if (skillPath.startsWith('inline:')) return undefined;
  return path.dirname(skillPath);
}

/** 创建 read_skill 工具。 */
export function createReadSkillTool(deps: ReadSkillDeps): ToolDefinition {
  const backend = deps.getBackend();
  const skills = backend.listSkills();

  return {
    declaration: buildDeclaration(skills),
    handler: async (args) => {
      const skillPath = typeof args.path === 'string' ? args.path.trim() : '';
      if (!skillPath) {
        return {
          success: false,
          error: 'Missing required parameter: path',
        };
      }

      const skill = deps.getBackend().getSkillByPath(skillPath);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillPath}`,
        };
      }

      return {
        success: true,
        name: skill.name,
        path: skill.path,
        basePath: getSkillBasePath(skill.path),
        description: skill.description,
        content: skill.content,
      };
    },
    // Skill 读取会向当前会话注入新的长文本上下文，不适合与相邻工具并行执行。
    parallel: false,
  };
}
