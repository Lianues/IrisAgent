import type { Disposable } from 'irises-extension-sdk';
import type { Command } from './input-commands';

export const CONSOLE_SLASH_COMMAND_SERVICE_ID = 'console:slash-command';

export interface ConsoleSlashCommandResult {
  message?: string;
  isError?: boolean;
  label?: string;
}

export interface ConsoleSlashCommandHandlerInput {
  raw: string;
  name: string;
  arg: string;
}

export interface ConsoleSlashCommandDefinition extends Command {
  handle(input: ConsoleSlashCommandHandlerInput): ConsoleSlashCommandResult | Promise<ConsoleSlashCommandResult | void> | void;
}

export interface ConsoleSlashCommandService {
  register(command: ConsoleSlashCommandDefinition): Disposable;
  list(): Command[];
  canHandle(raw: string): boolean;
  dispatch(raw: string): Promise<ConsoleSlashCommandResult | undefined>;
  onDidChange(listener: () => void): Disposable;
}

const commands = new Map<string, ConsoleSlashCommandDefinition>();
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* ignore */ }
  }
}

function matchCommand(rawInput: string): { command: ConsoleSlashCommandDefinition; arg: string } | undefined {
  const raw = rawInput.trim();
  if (!raw.startsWith('/')) return undefined;
  let best: { command: ConsoleSlashCommandDefinition; arg: string } | undefined;
  for (const command of commands.values()) {
    const name = command.name.trim();
    if (raw === name || raw.startsWith(`${name} `)) {
      const arg = raw === name ? '' : raw.slice(name.length).trim();
      if (!best || name.length > best.command.name.length) best = { command, arg };
    }
  }
  return best;
}

export const consoleSlashCommandService: ConsoleSlashCommandService = {
  register(command) {
    commands.set(command.name, command);
    emitChange();
    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        if (commands.get(command.name) === command) {
          commands.delete(command.name);
          emitChange();
        }
      },
    };
  },
  list() {
    return Array.from(commands.values()).map(({ handle: _handle, ...command }) => command);
  },
  canHandle(raw) {
    return !!matchCommand(raw);
  },
  async dispatch(raw) {
    const matched = matchCommand(raw);
    if (!matched) return undefined;
    const result = await matched.command.handle({ raw: raw.trim(), name: matched.command.name, arg: matched.arg });
    return result ?? {};
  },
  onDidChange(listener) {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
  },
};

export function getSlashCommands(): Command[] {
  return consoleSlashCommandService.list();
}

export function onSlashCommandsChanged(listener: () => void): Disposable {
  return consoleSlashCommandService.onDidChange(listener);
}

export function canHandleSlashCommand(raw: string): boolean {
  return consoleSlashCommandService.canHandle(raw);
}

export function dispatchSlashCommand(raw: string): Promise<ConsoleSlashCommandResult | undefined> {
  return consoleSlashCommandService.dispatch(raw);
}
