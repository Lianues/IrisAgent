export type TerminalShellKind = 'bash' | 'zsh' | 'powershell';

export interface TerminalClassifierConfig {
  enabled: boolean;
  model?: string;
  confidenceThreshold?: number;
  fallbackPolicy?: 'deny' | 'allow';
  timeout?: number;
}

export interface TerminalUseConfig {
  enabled: boolean;
  shell?: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  startupTimeoutMs: number;
  defaultCommandTimeoutMs: number;
  defaultWaitTimeoutMs: number;
  idleQuietMs: number;
  maxDisplayChars: number;
  maxCommandOutputChars: number;
  maxRecentSnapshots: number;
}

export interface TerminalState {
  display: string;
  rows: number;
  cols: number;
  cursorRow: number;
  cursorCol: number;
  promptReady: boolean;
  altScreen: boolean;
  shellKind: TerminalShellKind;
  cwd?: string;
  output?: string;
  commandOutput?: string;
  exitCode?: number;
  timedOut?: boolean;
  truncated?: {
    display?: boolean;
    output?: boolean;
    commandOutput?: boolean;
  };
  scrollback?: {
    offset: number;
    maxOffset: number;
  };
}

export interface ExecCommandResult extends TerminalState {
  command: string;
}

export interface ResolvedTerminalShell {
  command: string;
  args: string[];
  displayName: string;
  kind: TerminalShellKind;
}

export interface TerminalEnv {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  snapshot(resetScroll?: boolean): Promise<TerminalState>;
  execCommand(command: string, timeoutMs: number): Promise<ExecCommandResult>;
  typeText(text: string, timeoutMs?: number): Promise<TerminalState>;
  pressKey(key: string, timeoutMs?: number): Promise<TerminalState>;
  scroll(direction: 'up' | 'down', lines?: number): Promise<TerminalState>;
  wait(milliseconds?: number, untilIdle?: boolean, timeoutMs?: number): Promise<TerminalState>;
  interrupt(timeoutMs?: number): Promise<TerminalState>;
  readonly shellKind?: TerminalShellKind;
}

export interface MarkerInfo {
  exitCode: number;
  cwd?: string;
}

export interface SidecarInitializeParams {
  shell?: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  startupTimeoutMs: number;
  idleQuietMs: number;
  maxDisplayChars: number;
  maxCommandOutputChars: number;
}
