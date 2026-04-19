import { describe, expect, it } from 'vitest';
import { resolveTerminalShell } from '../extensions/terminal-use/src/shell-resolver.js';

describe('terminal-use shell resolver', () => {
  it('显式指定 zsh 时应保留 zsh 并使用交互模式参数', () => {
    const resolved = resolveTerminalShell('/bin/zsh');
    expect(resolved).toEqual({
      command: '/bin/zsh',
      args: ['-i'],
      displayName: '/bin/zsh',
      kind: 'zsh',
    });
  });

  it('显式指定 bash 时应使用无 profile 的交互参数', () => {
    const resolved = resolveTerminalShell('/bin/bash');
    expect(resolved).toEqual({
      command: '/bin/bash',
      args: ['--noprofile', '--norc', '-i'],
      displayName: '/bin/bash',
      kind: 'bash',
    });
  });
});
