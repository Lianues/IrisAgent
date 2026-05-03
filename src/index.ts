/**
 * 入口文件（平台模式）
 *
 * 使用 IrisHost 统一管理所有 Agent，通过能力接口检测区分平台行为。
 * 不出现任何硬编码平台名称（如 'web'/'console'）。
 *
 * 启动流程：
 *   1. IrisHost.start() → 加载 Agent 定义，为每个 Agent 创建 IrisCore
 *   2. 仅为默认 Agent（第一个）创建平台适配器
 *      - 非默认 Agent 只启动后端（backend / IPC），供 delegate 等跨 Agent 机制调用
 *      - console 等前台平台通过 agentNetwork 实现 Agent 切换，不需要为每个 Agent 各建一套平台
 *   3. 启动平台
 *   4. 等待退出条件（信号 / 前台平台退出）
 *   5. IrisHost.shutdown() → 优雅关闭所有资源
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { Transform } from 'node:stream';
import { IrisHost } from './core/iris-host';
import { IrisCore } from './core/iris-core';
import {
  PlatformAdapter,
  isMultiAgentCapable,
  isForegroundPlatform,
  isRoutableHttpPlatform,
} from 'irises-extension-sdk';
import type { MultiAgentCapable, ForegroundPlatform } from 'irises-extension-sdk';
import { isCompiledBinary } from './paths';

// ============ 平台创建 ============

/**
 * 为单个 Core 创建所有配置的平台适配器。
 */
async function createPlatformsForCore(
  core: IrisCore,
): Promise<PlatformAdapter[]> {
  const { config, configDir, router } = core;
  const platforms: PlatformAdapter[] = [];

  // 只恢复第一个平台的 lastModel，避免多个平台互相覆盖全局当前模型
  let modelRestored = false;
  for (const platformType of config.platform.types) {
    if (!core.platformRegistry.has(platformType)) {
      console.error(`[Iris] 未注册的平台类型: ${platformType}`);
      continue;
    }

    if (!modelRestored && config.llm.rememberPlatformModel) {
      const lastModelMap = config.platform.lastModel as Record<string, string> | undefined;
      const lastModel = lastModelMap?.[platformType];
      if (lastModel && router.hasModel(lastModel)) {
        try { core.backend.switchModel(lastModel); } catch { /* ignore */ }
      }
    }
    modelRestored = true;


    const platform = await core.platformRegistry.create(platformType, {
      backend: core.backendHandle,
      config,
      configDir,
      router,
      agentName: core.agentName,
      extensions: core.extensions,
      initWarnings: core.initWarnings,
      eventBus: core.eventBus,
      api: core.irisAPI,
      isCompiledBinary,
      supportsHeadlessTransition: true,
    });

    platforms.push(platform);
  }

  return platforms;
}

/**
 * 仅为默认 Agent（第一个 Core）创建平台。
 *
 * 设计原则：
 *   - 平台是用户界面层，一个进程只需要一套平台实例。
 *   - 非默认 Agent 只有后端（backend + IPC），不需要自己的平台。
 *   - console（ForegroundPlatform）独占 stdin/stdout，天然只能有一个。
 *   - web（MultiAgentCapable）通过 addAgent 注册多个 backend 到同一个 HTTP 服务。
 *   - 非默认 Agent 的交互通过以下机制完成：
 *     · delegate_to_agent 工具：直接调用目标 Agent 的 backend.chat()
 *     · console Agent 切换：通过 agentNetwork 获取目标 backendHandle 并 swap
 *     · IPC：每个 Agent 有独立的 IPC 端口，外部客户端可直接连接
 */
async function createPlatforms(host: IrisHost) {
  const allPlatforms: PlatformAdapter[] = [];
  let sharedPlatform: (PlatformAdapter & MultiAgentCapable) | undefined;
  let foregroundPlatform: (PlatformAdapter & ForegroundPlatform) | undefined;

  // 只为默认 Agent（第一个 Core）创建平台。
  // 非默认 Agent 只有 backend + IPC，不创建平台实例。
  const defaultCore = host.getDefaultCore();
  const platforms = await createPlatformsForCore(defaultCore);

  for (const platform of platforms) {
    // MultiAgentCapable 平台（如 web）：将其他 Agent 注册进来
    if (isMultiAgentCapable(platform) && !sharedPlatform) {
      sharedPlatform = platform;

      // 多 Agent 模式下将非默认 Core 注册到共享平台
      if (host.cores.size > 1) {
        for (const [agentName, agentCore] of host.cores) {
          if (agentCore === defaultCore) continue; // 创建者已自动注册
          const agentDefs = host.getAgentDefs();
          const displayName = agentDefs.find(d => d.name === agentName)?.description;
          sharedPlatform.addAgent(
            agentName,
            agentCore.backendHandle,
            {
              platform: agentCore.config.platform,
              configPath: agentCore.configDir,
              provider: agentCore.router.getCurrentModelInfo().provider,
              modelId: agentCore.router.getCurrentModelInfo().modelId,
              streamEnabled: agentCore.config.system.stream,
            },
            displayName,
            { llmProviders: agentCore.extensions.llmProviders, ocrProviders: agentCore.extensions.ocrProviders },
          );
        }
      }
    }

    // RoutableHttpPlatform 平台：绑定路由注册器
    if (isRoutableHttpPlatform(platform)) {
      defaultCore.bindRouteRegistrar(platform.registerRoute.bind(platform));
    }

    // ForegroundPlatform 平台：记录引用
    if (isForegroundPlatform(platform) && !foregroundPlatform) {
      foregroundPlatform = platform;
    }

    allPlatforms.push(platform);
  }

  // 通知默认 Core 的插件
  if (defaultCore.pluginManager) {
    const platformMap = new Map<string, PlatformAdapter>();
    for (let i = 0; i < defaultCore.config.platform.types.length && i < platforms.length; i++) {
      platformMap.set(defaultCore.config.platform.types[i], platforms[i]);
    }
    await defaultCore.pluginManager.notifyPlatformsReady(platformMap);
  }

  // 热重载注入
  if (sharedPlatform?.setReloadHandler) {
    sharedPlatform.setReloadHandler(async (agent: any): Promise<any> => {
      const agentName = (typeof agent === 'object' ? agent.name : undefined) ?? 'master';
      return await host.reloadAgent(agentName);
    });
  }

  return { allPlatforms, sharedPlatform, foregroundPlatform };
}

async function waitForShutdownSignal(shutdown: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    let requested = false;
    const keepAlive = setInterval(() => {}, 2 ** 31 - 1);
    const requestShutdown = () => {
      if (requested) return;
      requested = true;
      void shutdown().finally(() => {
        clearInterval(keepAlive);
        process.off('SIGINT', requestShutdown);
        process.off('SIGTERM', requestShutdown);
        resolve();
      });
    };
    process.on('SIGINT', requestShutdown);
    process.on('SIGTERM', requestShutdown);
  });
}

type HeadlessConsoleCommand = 'tui' | 'shutdown';

function normalizeHeadlessCommand(line: string): string {
  const trimmed = line.trim().toLowerCase();
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

function writeHeadlessConsoleLine(message: string): void {
  try {
    fs.writeSync(1, message.endsWith('\n') ? message : `${message}\n`);
  } catch {
    // fallback：极端情况下 stdout 不可写时仍尝试 console.log
    console.log(message);
  }
}

function resetTerminalInputModesForHeadlessPrompt(): void {
  try {
    fs.writeSync(1,
      '\x1b[?9l'     // X10 mouse tracking off
      + '\x1b[?1000l' // mouse button tracking off
      + '\x1b[?1001l' // highlight mouse tracking off
      + '\x1b[?1002l' // mouse drag tracking off
      + '\x1b[?1003l' // any-event mouse tracking off
      + '\x1b[?1004l' // focus event tracking off
      + '\x1b[?1005l' // UTF-8 mouse mode off
      + '\x1b[?1006l' // SGR mouse mode off
      + '\x1b[?1007l' // alternate scroll mode off
      + '\x1b[?1015l' // urxvt mouse mode off
      + '\x1b[?1016l' // SGR pixel mouse mode off
      + '\x1b[?2004l' // bracketed paste off
      + '\x1b[?2026l'
      + '\x1b[?2027l'
      + '\x1b[?2031l'
      + '\x1b[>4;0m'  // xterm modifyOtherKeys off
      + '\x1b[<u'     // kitty keyboard protocol pop/disable (best effort)
    );
  } catch { /* ignore */ }
}

function printHeadlessConsoleHelp(canReopenTui: boolean): void {
  if (canReopenTui) {
    writeHeadlessConsoleLine('[Iris] Headless 命令：输入 tui / attach / reconnect 重新打开 TUI；输入 exit / shutdown 关闭 Core；输入 help 查看帮助。');
  } else {
    writeHeadlessConsoleLine('[Iris] Headless 命令：输入 exit / shutdown 关闭 Core；输入 help 查看帮助。');
  }
}

const ANSI_INPUT_SEQUENCE_RE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[PX^_][\s\S]*?\x1B\\|[@-Z\\-_])/g;
const X10_MOUSE_SEQUENCE_RE = /\x1B\[M[\s\S]{3}/g;
const COMPLETE_ANSI_INPUT_SEQUENCE_RE = /^\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[PX^_][\s\S]*?\x1B\\|[@-Z\\-_])$/;
const COMPLETE_X10_MOUSE_SEQUENCE_RE = /^\x1B\[M[\s\S]{3}$/;

function stripTerminalControlInput(text: string): string {
  return text
    .replace(X10_MOUSE_SEQUENCE_RE, '')
    .replace(ANSI_INPUT_SEQUENCE_RE, '');
}

function createHeadlessInputFilter(): Transform {
  let pendingEscape = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      let text = pendingEscape + chunk.toString('utf8');
      pendingEscape = '';

      const lastEsc = text.lastIndexOf('\x1b');
      if (lastEsc >= 0) {
        const tail = text.slice(lastEsc);
        if (!COMPLETE_ANSI_INPUT_SEQUENCE_RE.test(tail) && !COMPLETE_X10_MOUSE_SEQUENCE_RE.test(tail)) {
          pendingEscape = tail;
          text = text.slice(0, lastEsc);
        }
      }

      const stripped = stripTerminalControlInput(text);
      if (stripped) this.push(stripped);
      callback();
    },
    flush(callback) {
      const stripped = stripTerminalControlInput(pendingEscape);
      if (stripped) this.push(stripped);
      callback();
    },
  });
}

async function waitForHeadlessConsoleCommand(
  canReopenTui: boolean,
): Promise<HeadlessConsoleCommand> {
  return await new Promise<HeadlessConsoleCommand>((resolve) => {
    resetTerminalInputModesForHeadlessPrompt();
    const inputFilter = createHeadlessInputFilter();
    process.stdin.pipe(inputFilter);

    const rl = readline.createInterface({
      input: inputFilter,
      output: process.stdout,
      prompt: '[Iris headless] > ',
    });

    const prompt = () => {
      // 某些终端在 focus/click 后可能恢复部分输入模式；每次显示 prompt 前都重置一次。
      resetTerminalInputModesForHeadlessPrompt();
      rl.prompt();
    };

    let settled = false;
    let onSigTerm: () => void;
    const finish = (command: HeadlessConsoleCommand) => {
      if (settled) return;
      settled = true;
      process.off('SIGTERM', onSigTerm);
      try { process.stdin.unpipe(inputFilter); } catch { /* ignore */ }
      inputFilter.destroy();
      rl.close();
      resolve(command);
    };

    onSigTerm = () => finish('shutdown');
    process.on('SIGTERM', onSigTerm);

    rl.on('SIGINT', () => finish('shutdown'));
    rl.on('close', () => {
      // stdin 被关闭时优雅关闭 Core，避免进程留在不可交互状态。
      finish('shutdown');
    });

    rl.on('line', (line) => {
      const command = normalizeHeadlessCommand(line);

      // 如果终端仍有极少量鼠标/控制序列残留，避免把它当成用户命令刷屏。
      if (line.includes('\x1b')) {
        prompt();
        return;
      }

      if (!command) {
        prompt();
        return;
      }

      if (command === 'help' || command === '?') {
        printHeadlessConsoleHelp(canReopenTui);
        prompt();
        return;
      }

      if (canReopenTui && ['tui', 'attach', 'reconnect', 'resume', 'open'].includes(command)) {
        finish('tui');
        return;
      }

      if (['exit', 'quit', 'shutdown', 'stop'].includes(command)) {
        finish('shutdown');
        return;
      }

      writeHeadlessConsoleLine(`[Iris] 未知 headless 命令: ${command}`);
      printHeadlessConsoleHelp(canReopenTui);
      prompt();
    });

    printHeadlessConsoleHelp(canReopenTui);
    prompt();
  });
}

// ============ 主入口 ============

async function main() {
  // 1. 启动 Host（创建所有 Core）
  //    所有 Agent 的 backend + IPC 在此阶段全部就绪，
  //    保证 delegate_to_agent 等跨 Agent 机制可用。
  const host = new IrisHost();
  await host.start();

  // 2. 仅为默认 Agent 创建平台
  const { allPlatforms, foregroundPlatform } = await createPlatforms(host);

  // 3. 优雅关闭
  const stoppedPlatforms = new Set<PlatformAdapter>();
  const stopPlatforms = async (platforms: PlatformAdapter[]) => {
    await Promise.allSettled(platforms
      .filter(p => !stoppedPlatforms.has(p))
      .map(async (p) => {
        await p.stop();
        stoppedPlatforms.add(p);
      }));
  };

  const startStoppedPlatforms = async (platforms: PlatformAdapter[]) => {
    for (const platform of platforms) {
      if (!stoppedPlatforms.has(platform)) continue;
      await platform.start();
      stoppedPlatforms.delete(platform);
    }
  };

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (allPlatforms.length > 0) {
        await stopPlatforms(allPlatforms);
      }
      await host.shutdown();
    })();
    return shutdownPromise;
  };

  // 4. 如果配置了平台但没有任何平台创建成功，仍视为配置错误；
  //    只有 platform.types 为空时才进入显式 Core-only / Headless 模式。
  if (allPlatforms.length === 0) {
    const configuredPlatformTypes = host.getDefaultCore().config.platform.types;
    if (configuredPlatformTypes.length > 0) {
      console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
      await shutdown();
      process.exit(1);
    }

    console.log('[Iris] 未配置平台，已进入 Core-only 后台模式。');
    console.log('[Iris] Core / IPC 已启动，可通过 iris attach 或 IPC 客户端连接。');
    const agentNames = host.listCoreNames();
    if (agentNames.length > 0) {
      console.log(`[Iris] 活跃 Agent: ${agentNames.join(', ')}`);
    }

    const command = await waitForHeadlessConsoleCommand(false);
    if (command === 'shutdown') {
      await shutdown();
    }
    process.exit(0);
  }

  // 5. 启动后台平台
  const backgroundPlatforms = allPlatforms.filter(p => p !== foregroundPlatform);
  if (backgroundPlatforms.length > 0) {
    await Promise.all(backgroundPlatforms.map(p => p.start()));
  }

  // 6. 前台平台处理
  if (foregroundPlatform) {
    // 前台平台（Console TUI）自己处理 Ctrl+C（exitOnCtrlC: false + useKeyboard）
    // SIGINT 必须被吞掉，否则 Windows 下 Ctrl+C 同时触发 TUI 退出 + 进程信号退出，终端崩溃
    process.on('SIGINT', () => { /* Console TUI 内部处理，此处忽略 */ });
    process.on('SIGTERM', () => void shutdown());

    for (;;) {
      stoppedPlatforms.delete(foregroundPlatform);
      await startStoppedPlatforms(backgroundPlatforms);
      await foregroundPlatform.start();
      const action = await (foregroundPlatform as PlatformAdapter & ForegroundPlatform).waitForExit();

      // ConsolePlatform 在 resolve waitForExit 前已经 stop()；避免 shutdown 时重复 stop。
      stoppedPlatforms.add(foregroundPlatform);

      if (action === 'headless') {
        const consoleAlreadyPrintedHeadlessNotice = process.platform === 'win32';
        if (!consoleAlreadyPrintedHeadlessNotice) {
          console.log('[Iris] Console TUI 已关闭，正在切换为 Core-only 后台模式...');
        }
        if (backgroundPlatforms.length > 0) {
          await stopPlatforms(backgroundPlatforms);
        }
        if (!consoleAlreadyPrintedHeadlessNotice) {
          console.log('[Iris] Core / IPC 仍在运行，可通过 iris attach 重新连接。');
        }
        const agentNames = host.listCoreNames();
        if (agentNames.length > 0) {
          console.log(`[Iris] 活跃 Agent: ${agentNames.join(', ')}`);
        }
        if (!consoleAlreadyPrintedHeadlessNotice) console.log('[Iris] 按 Ctrl+C 可关闭后台 Core。');

        const command = await waitForHeadlessConsoleCommand(true);
        if (command === 'tui') {
          console.log('[Iris] 正在重新打开 Console TUI...');
          continue;
        }

        await shutdown();
        process.exit(0);
      } else {
        await shutdown();
        process.exit(0);
      }
    }
  } else {
    // 无前台平台（纯后台服务模式）：信号直接触发关闭
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
