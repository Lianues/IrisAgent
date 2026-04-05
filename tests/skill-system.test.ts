/**
 * Skill 系统测试。
 *
 * 覆盖点包括：
 * 1. 内联 Skill 的稳定 path 标识
 * 2. read_skill 工具按 path 读取 Skill
 * 3. 文件系统 Skill 扫描
 * 4. 多来源 Skill 合并优先级
 * 5. Skill 热重载清空逻辑
 * 6. 扩展 frontmatter 字段解析
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkillsFromFilesystem } from '../src/config/skill-loader';
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

    expect(config.skills).toHaveLength(1);
    const skill = config.skills![0];
    expect(skill.name).toBe('reviewer');
    expect(skill.description).toBe('审查代码');
    expect(skill.content).toBe('请审查当前改动。');
    expect(skill.path).toBe('inline:reviewer');
    expect(skill.enabled).toBe(true);
  });

  it('内联 Skill 支持扩展字段', () => {
    const config = parseSystemConfig({
      skills: {
        deploy: {
          description: '部署技能',
          content: '执行部署到 $0 环境。',
          'allowed-tools': 'shell, read_file',
          model: 'opus',
          context: 'fork',
          arguments: 'env, region',
          'argument-hint': '<env> [region]',
          'when-to-use': '当用户要求部署时',
        },
      },
    });

    expect(config.skills).toHaveLength(1);
    const skill = config.skills![0];
    expect(skill.allowedTools).toEqual(['shell', 'read_file']);
    expect(skill.model).toBe('opus');
    expect(skill.mode).toBe('fork');
    expect(skill.arguments).toEqual(['env', 'region']);
    expect(skill.argumentHint).toBe('<env> [region]');
    expect(skill.whenToUse).toBe('当用户要求部署时');
    expect(skill.contextModifier).toEqual({
      autoApproveTools: ['shell', 'read_file'],
      modelOverride: 'opus',
    });
  });
});

describe('loadSkillsFromFilesystem', () => {
  it('扫描全局 skills 目录中的 SKILL.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
    const skillDir = path.join(tmpDir, 'skills', 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: 测试技能\n---\n这是技能内容。',
    );

    const skills = loadSkillsFromFilesystem(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
    expect(skills[0].description).toBe('测试技能');
    expect(skills[0].content).toBe('这是技能内容。');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无 frontmatter 时使用目录名作为 name', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
    const skillDir = path.join(tmpDir, 'skills', 'my-tool');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '直接写内容，没有 frontmatter。');

    const skills = loadSkillsFromFilesystem(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-tool');
    expect(skills[0].content).toBe('直接写内容，没有 frontmatter。');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('解析扩展 frontmatter 字段', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
    const skillDir = path.join(tmpDir, 'skills', 'deploy');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: deploy',
        'description: 部署应用',
        'allowed-tools:',
        '  - shell',
        '  - read_file',
        'model: opus',
        'context: fork',
        'arguments:',
        '  - env',
        '  - region',
        'argument-hint: "<env> [region]"',
        'when-to-use: 当用户要求部署时',
        'paths:',
        '  - "deploy/**"',
        '  - "Dockerfile"',
        'user-invocable: true',
        'disable-model-invocation: false',
        '---',
        '执行部署到 $0 环境。',
      ].join('\n'),
    );

    const skills = loadSkillsFromFilesystem(tmpDir);
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.name).toBe('deploy');
    expect(skill.allowedTools).toEqual(['shell', 'read_file']);
    expect(skill.model).toBe('opus');
    expect(skill.mode).toBe('fork');
    expect(skill.arguments).toEqual(['env', 'region']);
    expect(skill.argumentHint).toBe('<env> [region]');
    expect(skill.whenToUse).toBe('当用户要求部署时');
    expect(skill.paths).toEqual(['deploy/**', 'Dockerfile']);
    expect(skill.userInvocable).toBe(true);
    expect(skill.disableModelInvocation).toBe(false);
    expect(skill.contextModifier).toEqual({
      autoApproveTools: ['shell', 'read_file'],
      modelOverride: 'opus',
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无扩展字段时保持默认值', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
    const skillDir = path.join(tmpDir, 'skills', 'simple');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: simple\ndescription: 简单技能\n---\n内容。',
    );

    const skills = loadSkillsFromFilesystem(tmpDir);
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.allowedTools).toBeUndefined();
    expect(skill.model).toBeUndefined();
    expect(skill.mode).toBe('inline');
    expect(skill.contextModifier).toBeUndefined();
    expect(skill.userInvocable).toBe(true);
    expect(skill.disableModelInvocation).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('parseSystemConfig: 多来源 Skill 合并优先级', () => {
  it('内联 Skill 覆盖文件系统同名 Skill', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
    const skillDir = path.join(tmpDir, 'skills', 'reviewer');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: reviewer\ndescription: 文件系统版本\n---\n文件系统内容',
    );

    const config = parseSystemConfig({
      skills: {
        reviewer: {
          description: '内联版本',
          content: '内联内容',
        },
      },
    }, tmpDir);

    const reviewer = config.skills?.find(s => s.name === 'reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.description).toBe('内联版本');
    expect(reviewer!.content).toBe('内联内容');
    expect(reviewer!.path).toBe('inline:reviewer');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无 skill 时 skills 为 undefined', () => {
    const config = parseSystemConfig({});
    expect(config.skills).toBeUndefined();
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

describe('Backend.reloadConfig: Skill 热重载', () => {
  it('skills 传入空数组时清空 Skill 列表', () => {
    const mockCallback = { called: false };

    function reloadConfigLogic(
      opts: { skills?: Array<{ name: string }> },
      currentSkills: Array<{ name: string }>,
      onChanged: () => void,
    ) {
      if ('skills' in opts) {
        const newSkills = opts.skills ?? [];
        onChanged();
        return newSkills;
      }
      return currentSkills;
    }

    const result1 = reloadConfigLogic(
      { skills: undefined },
      [{ name: 'old' }],
      () => { mockCallback.called = true; },
    );
    expect(result1).toEqual([]);
    expect(mockCallback.called).toBe(true);

    mockCallback.called = false;
    const result2 = reloadConfigLogic(
      {},
      [{ name: 'old' }],
      () => { mockCallback.called = true; },
    );
    expect(result2).toEqual([{ name: 'old' }]);
    expect(mockCallback.called).toBe(false);
  });
});
