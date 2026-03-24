/**
 * Skill 系统按需读取测试。
 *
 * 这些测试覆盖本次重构的两个核心点：
 * 1. 内联 Skill 会生成稳定的 path 标识，而不是依赖旧的 enabled 状态
 * 2. read_skill 工具会按 path 返回 Skill 全文和 basePath，而不是启用后拼接到消息末尾
 */

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSystemConfig } from '../src/config/system';
import { createReadSkillTool } from '../src/tools/internal/read_skill';

describe('parseSystemConfig: inline skills', () => {
  it('为内联 Skill 生成稳定的 inline:path 标识', () => {
    const config = parseSystemConfig({
      skills: {
        reviewer: {
          description: '审查代码',
          content: '请审查当前改动。',
          enabled: true,
        },
      },
    });

    expect(config.skills).toEqual([
      {
        name: 'reviewer',
        description: '审查代码',
        content: '请审查当前改动。',
        path: 'inline:reviewer',
        enabled: true,
      },
    ]);
  });
});

describe('createReadSkillTool', () => {
  it('按 path 返回 Skill 全文，并为文件系统 Skill 提供 basePath', async () => {
    const skillPath = path.join('workspace', '.agents', 'skills', 'reviewer', 'SKILL.md');
    const skill = {
      name: 'reviewer',
      path: skillPath,
      description: '审查代码',
      content: '# reviewer\n请审查代码。',
    };

    const tool = createReadSkillTool({
      getBackend: () => ({
        listSkills: () => [skill],
        getSkillByPath: (inputPath: string) => (inputPath === skillPath ? skill : undefined),
      }) as any,
    });

    expect(tool.declaration.name).toBe('read_skill');
    expect(tool.declaration.description).toContain('- name: "reviewer"');
    expect(tool.declaration.description).toContain(`path: ${JSON.stringify(skillPath)}`);

    const result = await tool.handler({ path: skillPath }) as any;
    expect(result).toEqual({
      success: true,
      name: 'reviewer',
      path: skillPath,
      basePath: path.dirname(skillPath),
      description: '审查代码',
      content: '# reviewer\n请审查代码。',
    });
  });

  it('内联 Skill 返回 undefined basePath，并在缺失时返回错误', async () => {
    const inlineSkill = {
      name: 'translator',
      path: 'inline:translator',
      description: '翻译文本',
      content: '请翻译文本。',
    };

    const tool = createReadSkillTool({
      getBackend: () => ({
        listSkills: () => [inlineSkill],
        getSkillByPath: (inputPath: string) => (inputPath === inlineSkill.path ? inlineSkill : undefined),
      }) as any,
    });

    const inlineResult = await tool.handler({ path: 'inline:translator' }) as any;
    expect(inlineResult.basePath).toBeUndefined();
    expect(inlineResult.success).toBe(true);

    const missingResult = await tool.handler({ path: 'inline:missing' }) as any;
    expect(missingResult).toEqual({
      success: false,
      error: 'Skill not found: inline:missing',
    });
  });
});
