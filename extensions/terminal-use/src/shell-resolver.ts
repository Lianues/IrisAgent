import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import type { ResolvedTerminalShell, TerminalShellKind } from './types.js';

function inferShellKind(command: string): TerminalShellKind {
  const base = path.basename(command).toLowerCase();
  if (base.includes('pwsh') || base.includes('powershell')) return 'powershell';
  if (base.includes('zsh')) return 'zsh';
  if (base.includes('bash') || base.includes('sh')) return 'bash';
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

function commandExists(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, {
      stdio: 'ignore',
      timeout: 3000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveTerminalShell(requestedShell?: string): ResolvedTerminalShell {
  if (requestedShell) {
    const kind = inferShellKind(requestedShell);
    const base = path.basename(requestedShell).toLowerCase();
    return {
      command: requestedShell,
      args: kind === 'powershell'
        ? ['-NoLogo', '-NoProfile']
        : (kind === 'zsh' || base.includes('zsh') ? ['-i'] : ['--noprofile', '--norc', '-i']),
      displayName: requestedShell,
      kind,
    };
  }

  if (process.platform === 'win32') {
    if (commandExists('pwsh.exe', ['-NoLogo', '-NoProfile', '-Command', 'exit 0'])) {
      return {
        command: 'pwsh.exe',
        args: ['-NoLogo', '-NoProfile'],
        displayName: 'PowerShell 7+',
        kind: 'powershell',
      };
    }
    if (commandExists('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'exit 0'])) {
      return {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile'],
        displayName: 'Windows PowerShell',
        kind: 'powershell',
      };
    }
    if (commandExists('bash.exe', ['-lc', 'exit 0'])) {
      return {
        command: 'bash.exe',
        args: ['--noprofile', '--norc', '-i'],
        displayName: 'bash',
        kind: 'bash',
      };
    }
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      displayName: 'Windows PowerShell',
      kind: 'powershell',
    };
  }

  if (commandExists('bash', ['-lc', 'exit 0'])) {
    return {
      command: 'bash',
      args: ['--noprofile', '--norc', '-i'],
      displayName: 'bash',
      kind: 'bash',
    };
  }

  const shell = process.env.SHELL?.trim();
  if (shell) {
    const base = path.basename(shell).toLowerCase();
    return {
      command: shell,
      args: inferShellKind(shell) === 'powershell'
        ? ['-NoLogo', '-NoProfile']
        : (inferShellKind(shell) === 'zsh' || base.includes('zsh') ? ['-i'] : ['--noprofile', '--norc', '-i']),
      displayName: shell,
      kind: inferShellKind(shell),
    };
  }

  return {
    command: '/bin/bash',
    args: ['--noprofile', '--norc', '-i'],
    displayName: '/bin/bash',
    kind: 'bash',
  };
}
