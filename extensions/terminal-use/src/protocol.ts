import type { MarkerInfo, TerminalShellKind } from './types.js';

export const OSC_MARKER_PREFIX = '\u001b]1337;IRIS_DONE=';
const OSC_MARKER_REGEX = /\u001b\]1337;IRIS_DONE=([^;\u0007\u001b]+);([^\u0007\u001b\\]*)(?:\u0007|\u001b\\)/g;

const BASH_PROMPT_COMMAND = "__iris_ec=$?; __iris_cwd_b64=$(printf '%s' \"$PWD\" | base64 | tr -d '\\r\\n'); printf '\\033]1337;IRIS_DONE=%s;%s\\007' \"$__iris_ec\" \"$__iris_cwd_b64\"";

function decodeBase64Utf8(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

export function consumeMarkers(previousCarry: string, chunk: string): { clean: string; carry: string; markers: MarkerInfo[] } {
  const combined = previousCarry + chunk;
  const lastStart = combined.lastIndexOf(OSC_MARKER_PREFIX);
  let processable = combined;
  let carry = '';

  if (lastStart >= 0) {
    const tail = combined.slice(lastStart);
    if (!tail.includes('\u0007') && !tail.includes('\u001b\\')) {
      processable = combined.slice(0, lastStart);
      carry = tail;
    }
  }

  const markers: MarkerInfo[] = [];
  const clean = processable.replace(OSC_MARKER_REGEX, (_full, exitCode, cwdB64) => {
    markers.push({
      exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0,
      cwd: decodeBase64Utf8(cwdB64),
    });
    return '';
  });

  return { clean, carry, markers };
}

export function buildWrappedCommand(command: string, shellKind: TerminalShellKind): string {
  if (shellKind === 'powershell') {
    return `${command}\n$__irisExit = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } elseif ($?) { 0 } else { 1 }; $__irisCwdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)); [Console]::Out.Write(([string][char]27) + "]1337;IRIS_DONE=$($__irisExit);$($__irisCwdB64)" + ([string][char]7))\n`;
  }
  return `${command}\n__iris_exit=$?; __iris_cwd_b64=$(printf '%s' "$PWD" | base64 | tr -d '\\r\\n'); printf '\\033]1337;IRIS_DONE=%s;%s\\007' "$__iris_exit" "$__iris_cwd_b64"\n`;
}

export function buildPowerShellPromptBootstrapCommand(): string {
  return [
    'function global:prompt {',
    '  $__irisSuccess = $?;',
    '  $__irisLastExit = $global:LASTEXITCODE;',
    '  $__irisCwd = (Get-Location).Path;',
    '  $__irisCwdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($__irisCwd));',
    '  $__irisExit = if ($null -ne $__irisLastExit) { [int]$__irisLastExit } elseif ($__irisSuccess) { 0 } else { 1 };',
    '  [Console]::Out.Write(([string][char]27) + "]1337;IRIS_DONE=$($__irisExit);$($__irisCwdB64)" + ([string][char]7));',
    '  "PS $($__irisCwd)> "',
    '}',
  ].join(' ');
}

export function buildBashPromptEnvironment(baseEnv: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...baseEnv,
    PROMPT_COMMAND: BASH_PROMPT_COMMAND,
    PS1: '\\w\\$ ',
  };
}

export function buildZshRcContent(): string {
  return [
    'setopt PROMPT_PERCENT',
    'HISTFILE=/dev/null',
    'HISTSIZE=0',
    'SAVEHIST=0',
    'function __iris_precmd_hook() {',
    '  local __iris_exit=$?',
    '  local __iris_cwd_b64',
    '  __iris_cwd_b64=$(printf "%s" "$PWD" | base64 | tr -d "\\r\\n")',
    '  printf "\\033]1337;IRIS_DONE=%s;%s\\007" "$__iris_exit" "$__iris_cwd_b64"',
    '}',
    'autoload -Uz add-zsh-hook',
    'add-zsh-hook precmd __iris_precmd_hook',
    'PROMPT="%~%# "',
    'RPROMPT=""',
  ].join('\n');
}
