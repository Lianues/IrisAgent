import type { FunctionDeclaration, LLMRouterLike, ToolDefinition, ToolExecutionContext } from 'irises-extension-sdk';
import type { TerminalClassifierConfig, TerminalEnv, TerminalShellKind, TerminalState, TerminalUseConfig } from './types.js';
import type { TerminalUseToolsConfig } from './config.js';
import { classifyStaticCommand, classifyWithLLM, resolveClassifierDecision } from './security.js';

interface InteractiveToolExecutionContext extends ToolExecutionContext {
  approvedByUser?: boolean;
  requestApproval?: () => Promise<boolean>;
}

interface TerminalUseToolDeps {
  getEnv: () => Promise<TerminalEnv>;
  restartEnv: () => Promise<TerminalState>;
  getConfig: () => TerminalUseConfig | undefined;
  getRouter: () => LLMRouterLike | undefined;
  getToolsConfig: () => TerminalUseToolsConfig;
}

function toToolResult(state: Record<string, unknown>): Record<string, unknown> {
  const {
    display,
    rows,
    cols,
    cursorRow,
    cursorCol,
    promptReady,
    altScreen,
    shellKind,
    cwd,
    scrollback,
    timedOut,
    truncated,
    exitCode,
    output,
    commandOutput,
    command,
  } = state;

  const meta: Record<string, unknown> = {
    rows,
    cols,
    cursorRow,
    cursorCol,
    promptReady,
    altScreen,
    shellKind,
  };

  if (cwd !== undefined) meta.cwd = cwd;
  if (scrollback !== undefined) meta.scrollback = scrollback;
  if (timedOut !== undefined) meta.timedOut = timedOut;
  if (truncated !== undefined) meta.truncated = truncated;
  if (exitCode !== undefined) meta.exitCode = exitCode;

  const result: Record<string, unknown> = {
    screen: display,
    meta,
  };

  if (output !== undefined) result.output = output;
  if (commandOutput !== undefined) result.commandOutput = commandOutput;
  if (command !== undefined) result.command = command;
  return result;
}

export const TERMINAL_USE_FUNCTION_NAMES = new Set([
  'get_terminal_snapshot',
  'restart_terminal',
  'exec_terminal_command',
  'type_terminal_text',
  'press_terminal_key',
  'scroll_terminal',
  'wait_terminal',
  'interrupt_terminal',
]);

function defaultShellKind(): TerminalShellKind {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

async function ensureActionApproved(
  toolName: string,
  autoApprove: boolean,
  context?: InteractiveToolExecutionContext,
): Promise<void> {
  if (autoApprove || context?.approvedByUser) return;
  if (context?.requestApproval) {
    const approved = await context.requestApproval();
    if (approved) return;
    throw new Error('用户已拒绝执行该操作。');
  }
  throw new Error(`terminal-use 工具「${toolName}」未启用自动批准，且当前上下文无法请求人工确认。请通过 terminal-use 的配置贡献开启该工具的 autoApprove。`);
}

async function authorizeCommand(
  command: string,
  shellKind: TerminalShellKind,
  cwd: string,
  router: LLMRouterLike | undefined,
  classifierConfig: TerminalClassifierConfig | undefined,
  context?: InteractiveToolExecutionContext,
  force: boolean = false,
): Promise<void> {
  const staticDecision = classifyStaticCommand(command, shellKind);

  if (staticDecision.result === 'deny') {
    throw new Error(`安全拒绝: ${staticDecision.reason}\n此命令处于 terminal-use 黑名单中，force 也无法绕过。`);
  }

  if (staticDecision.result === 'allow') {
    return;
  }

  if (context?.approvedByUser) {
    return;
  }

  if (force && !context?.requestApproval) {
    return;
  }

  const config = classifierConfig;
  if (!config?.enabled) {
    if (context?.requestApproval) {
      const approved = await context.requestApproval();
      if (approved) return;
      throw new Error('用户已拒绝执行该命令。');
    }
    throw new Error('命令不在安全白名单中且分类器未启用，拒绝执行。请让用户确认后使用 force: true，或在 terminal-use 的配置贡献中为 exec_terminal_command 启用 classifier。');
  }

  const classifierResult = await classifyWithLLM(command, shellKind, cwd, router, config);
  const decision = resolveClassifierDecision(classifierResult, config);

  if (decision.allow) {
    return;
  }

  if (context?.requestApproval) {
    const approved = await context.requestApproval();
    if (approved) return;
    throw new Error('用户已拒绝执行该命令。');
  }

  throw new Error(`AI 安全分类器拒绝执行: ${decision.reason}\n如果用户确认需要执行，可以设置 force: true 重试。`);
}

export function createTerminalUseTools(deps: TerminalUseToolDeps): ToolDefinition[] {
  const getConfig = () => deps.getConfig();
  const getToolsConfig = () => deps.getToolsConfig();
  const getDefaultCommandTimeout = () => getConfig()?.defaultCommandTimeoutMs ?? 30_000;
  const getDefaultWaitTimeout = () => getConfig()?.defaultWaitTimeoutMs ?? 10_000;

  return [
    {
      approvalMode: 'handler',
      declaration: {
        name: 'get_terminal_snapshot',
        description: '获取当前无头终端的可见页面文本。用于观察当前提示符、命令输出、TUI 界面或滚动后的视图。',
        parameters: {
          type: 'object',
          properties: {
            reset_scroll: {
              type: 'boolean',
              description: '是否重置滚动位置并回到底部实时视图，默认 false。',
            },
          },
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('get_terminal_snapshot', getToolsConfig().getTerminalSnapshotAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.snapshot((args.reset_scroll as boolean | undefined) ?? false) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'restart_terminal',
        description: '重启 terminal-use 的无头终端会话，并返回新会话的初始页面文本。会丢失当前终端中的未保存上下文、前台程序和会话状态。',
      },
      handler: async (_args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('restart_terminal', getToolsConfig().restartTerminalAutoApprove, context);
        return toToolResult(await deps.restartEnv() as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'exec_terminal_command',
        description: [
          '在持久终端会话中执行一条命令并等待返回 prompt 或超时。',
          '返回当前可见页面 display，以及本次命令执行产生的完整 commandOutput（过长会截断并标记）。',
          '适合 ls、git status、pytest、python script.py、npm run 等。',
          '如果命令启动了长时间运行的交互程序（如 python REPL、top、vim），超时后会返回当前页面，你可以继续用 wait_terminal / press_terminal_key / type_terminal_text 操作。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: '要执行的命令。建议单行输入；终端会保持状态，cd/export 等会影响后续操作。',
            },
            timeout: {
              type: 'number',
              description: '等待命令完成的超时（毫秒），默认取 terminal_use.yaml 中 defaultCommandTimeoutMs。',
            },
            force: {
              type: 'boolean',
              description: '在非交互上下文中跳过 AI 分类器的最终阻断。黑名单命令仍无法执行。',
            },
          },
          required: ['command'],
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        const env = await deps.getEnv();
        const currentState = await env.snapshot(false);
        const command = String(args.command ?? '');
        const timeout = Math.min((args.timeout as number | undefined) ?? getDefaultCommandTimeout(), 600_000);
        const force = args.force === true;
        await authorizeCommand(
          command,
          currentState.shellKind ?? env.shellKind ?? defaultShellKind(),
          currentState.cwd ?? getConfig()?.cwd ?? process.cwd(),
          deps.getRouter(),
          getToolsConfig().execTerminalCommandClassifier,
          context,
          force,
        );
        return toToolResult(await env.execCommand(command, timeout) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'type_terminal_text',
        description: '向当前终端焦点输入原始文本，但不额外发送 Enter。适合 REPL、TUI 输入框或分步构造命令。',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: '要输入的文本。会原样发送到当前终端会话。',
            },
            timeout: {
              type: 'number',
              description: '发送后等待终端稳定的最长时间（毫秒），默认约 800~1000ms。',
            },
          },
          required: ['text'],
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('type_terminal_text', getToolsConfig().typeTerminalTextAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.typeText(String(args.text ?? ''), args.timeout as number | undefined) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'press_terminal_key',
        description: '向终端发送一个按键或常见组合键，如 Enter、Up、Down、PageUp、Ctrl+C、Ctrl+D、Alt+X、Shift+Tab。',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: '按键名或组合键，例如 "Enter"、"Up"、"Ctrl+C"、"Alt+X"。',
            },
            timeout: {
              type: 'number',
              description: '发送后等待终端稳定的最长时间（毫秒）。',
            },
          },
          required: ['key'],
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('press_terminal_key', getToolsConfig().pressTerminalKeyAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.pressKey(String(args.key ?? ''), args.timeout as number | undefined) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'scroll_terminal',
        description: '滚动 terminal-use 的文本视图浏览 scrollback。它不会给程序发送 PageUp/PageDown，而是只改变你看到的页面。',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              description: '滚动方向：up 或 down。',
            },
            lines: {
              type: 'number',
              description: '滚动行数，默认约半屏。',
            },
          },
          required: ['direction'],
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('scroll_terminal', getToolsConfig().scrollTerminalAutoApprove, context);
        const env = await deps.getEnv();
        const direction = args.direction === 'up' ? 'up' : 'down';
        return toToolResult(await env.scroll(direction, args.lines as number | undefined) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: (() => {
        const declaration: FunctionDeclaration = {
          name: 'wait_terminal',
          description: '等待一段时间，或等待终端输出进入空闲状态，然后返回当前页面。适合等待长命令继续输出或动画/TUI 刷新。',
          parameters: {
            type: 'object',
            properties: {
              milliseconds: {
                type: 'number',
                description: '固定等待时间（毫秒），默认 1000。',
              },
              until_idle: {
                type: 'boolean',
                description: '若为 true，则等待到终端至少静默一个短窗口，或直到 timeout。',
              },
              timeout: {
                type: 'number',
                description: '当 until_idle=true 时的最长等待时间；否则可作为固定等待的上限说明。默认取 terminal_use.yaml 中 defaultWaitTimeoutMs。',
              },
            },
          },
        };
        return declaration;
      })(),
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('wait_terminal', getToolsConfig().waitTerminalAutoApprove, context);
        const env = await deps.getEnv();
        const timeout = (args.timeout as number | undefined) ?? getDefaultWaitTimeout();
        return toToolResult(await env.wait(
          args.milliseconds as number | undefined,
          (args.until_idle as boolean | undefined) ?? false,
          timeout,
        ) as unknown as Record<string, unknown>);
      },
    },
    {
      approvalMode: 'handler',
      declaration: {
        name: 'interrupt_terminal',
        description: '向当前终端发送 Ctrl+C 中断前台程序，并返回当前页面。适合停止卡住或运行过久的命令。',
        parameters: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: '中断后等待终端稳定的最长时间（毫秒）。',
            },
          },
        },
      },
      handler: async (args, rawContext) => {
        const context = rawContext as InteractiveToolExecutionContext | undefined;
        await ensureActionApproved('interrupt_terminal', getToolsConfig().interruptTerminalAutoApprove, context);
        const env = await deps.getEnv();
        return toToolResult(await env.interrupt(args.timeout as number | undefined) as unknown as Record<string, unknown>);
      },
    },
  ];
}
