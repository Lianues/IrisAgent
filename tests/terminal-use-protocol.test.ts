import { describe, expect, it } from 'vitest';
import {
  buildBashPromptEnvironment,
  buildPowerShellPromptBootstrapCommand,
  buildZshRcContent,
  consumeMarkers,
} from '../extensions/terminal-use/src/protocol.js';

describe('terminal-use protocol helpers', () => {
  it('应提取并移除完整的 OSC 完成标记', () => {
    const cwd = Buffer.from('/tmp/project', 'utf8').toString('base64');
    const chunk = `hello\u001b]1337;IRIS_DONE=7;${cwd}\u0007world`;
    const result = consumeMarkers('', chunk);

    expect(result.clean).toBe('helloworld');
    expect(result.carry).toBe('');
    expect(result.markers).toEqual([{ exitCode: 7, cwd: '/tmp/project' }]);
  });

  it('应正确处理跨 chunk 分裂的完成标记', () => {
    const cwd = Buffer.from('/tmp/project', 'utf8').toString('base64');
    const first = consumeMarkers('', `abc\u001b]1337;IRIS_DONE=0;${cwd.slice(0, 4)}`);
    const second = consumeMarkers(first.carry, `${cwd.slice(4)}\u0007xyz`);

    expect(first.clean).toBe('abc');
    expect(first.markers).toEqual([]);
    expect(first.carry).not.toBe('');

    expect(second.clean).toBe('xyz');
    expect(second.markers).toEqual([{ exitCode: 0, cwd: '/tmp/project' }]);
  });

  it('应生成带隐藏完成标记的 bash / powershell / zsh prompt hook', () => {
    const bashEnv = buildBashPromptEnvironment({});
    expect(bashEnv.PROMPT_COMMAND).toContain('IRIS_DONE');
    expect(buildPowerShellPromptBootstrapCommand()).toContain('IRIS_DONE');
    const zshRc = buildZshRcContent();
    expect(zshRc).toContain('IRIS_DONE');
    expect(zshRc).toContain('add-zsh-hook precmd');
  });
});
