/**
 * iris stop —— 关闭已运行的 Iris 实例
 *
 * 优先通过 IPC 请求目标进程优雅关闭；如果目标版本不支持或 IPC 不可达，
 * 回退到向 lock 文件中的 PID 发送 SIGTERM。--force 时最后使用 SIGKILL。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { dataDir } from './paths';
import { IPCClient } from './ipc/client';
import type { LockFileContent } from './ipc/protocol';

const SERVER_SHUTDOWN_METHOD = 'server.shutdown';

interface StopArgs {
  agentName?: string;
  force: boolean;
  timeoutMs: number;
}

interface LockTarget extends LockFileContent {
  lockFilePath: string;
}

interface StopResult {
  target: LockTarget;
  ok: boolean;
  message: string;
}

interface IpcShutdownResult {
  ok: boolean;
  reached: boolean;
  error?: unknown;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function printStopHelp(): void {
  console.log(`
iris stop — 关闭已运行的 Iris 实例

用法:
  iris stop                         关闭所有从当前数据目录发现的 Iris 实例
  iris stop --agent <name>          关闭指定 Agent 对应的 Iris 进程
  iris stop --force                 优雅关闭失败后强制结束进程

选项:
  --agent, -a <name>                Agent 名称
  --timeout <ms>                    等待进程退出的毫秒数（默认: ${DEFAULT_TIMEOUT_MS}）
  --force, -f                       优雅关闭失败后使用 SIGKILL
  -h, --help                        显示帮助
`);
}

function parseStopArgs(argv: string[]): StopArgs {
  const args: StopArgs = { force: false, timeoutMs: DEFAULT_TIMEOUT_MS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--agent' || arg === '-a') && argv[i + 1]) {
      args.agentName = argv[++i];
    } else if ((arg === '--timeout' || arg === '-t') && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
    } else if (arg === '--force' || arg === '-f') {
      args.force = true;
    } else if (arg === '--help' || arg === '-h') {
      printStopHelp();
      process.exit(0);
    }
  }

  return args;
}

function readLockTarget(lockFilePath: string): LockTarget | null {
  try {
    const content = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as LockFileContent;
    if (!content || typeof content.pid !== 'number' || typeof content.port !== 'number') return null;
    return { ...content, lockFilePath };
  } catch {
    return null;
  }
}

function discoverLockTargets(agentName?: string): LockTarget[] {
  if (agentName) {
    const lockFilePath = path.join(dataDir, `iris-${agentName}.lock`);
    const target = fs.existsSync(lockFilePath) ? readLockTarget(lockFilePath) : null;
    return target ? [target] : [];
  }

  if (!fs.existsSync(dataDir)) return [];

  const targets: LockTarget[] = [];
  for (const entry of fs.readdirSync(dataDir)) {
    if (!/^iris-.+\.lock$/.test(entry)) continue;
    const target = readLockTarget(path.join(dataDir, entry));
    if (target) targets.push(target);
  }
  return targets;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM 表示进程存在但当前用户无权限发信号。
    return err?.code === 'EPERM';
  }
}

function removeLockIfDead(target: LockTarget): void {
  if (isProcessAlive(target.pid)) return;
  try {
    if (fs.existsSync(target.lockFilePath)) fs.unlinkSync(target.lockFilePath);
  } catch {
    // 清理失败不影响 stop 的主流程。
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return !isProcessAlive(pid);
}

async function requestShutdownViaIpc(target: LockTarget): Promise<IpcShutdownResult> {
  const client = new IPCClient({ timeout: 3_000 });
  let reached = false;
  try {
    await client.connect(target.port);
    reached = true;
    await client.call(SERVER_SHUTDOWN_METHOD, [], { timeout: 3_000 });
    return { ok: true, reached };
  } catch (error) {
    return { ok: false, reached, error };
  } finally {
    client.disconnect();
  }
}

async function stopTarget(target: LockTarget, args: StopArgs): Promise<StopResult> {
  if (!isProcessAlive(target.pid)) {
    removeLockIfDead(target);
    return {
      target,
      ok: true,
      message: `PID=${target.pid} 已不存在，已清理残留 lock: ${target.lockFilePath}`,
    };
  }

  let gracefulError: unknown;
  const ipcResult = await requestShutdownViaIpc(target);
  if (ipcResult.ok) {
    if (await waitForProcessExit(target.pid, args.timeoutMs)) {
      removeLockIfDead(target);
      return { target, ok: true, message: `已优雅关闭 PID=${target.pid} (agent=${target.agentName})` };
    }
    gracefulError = new Error(`等待退出超时 (${args.timeoutMs}ms)`);
  } else {
    gracefulError = ipcResult.error;
    if (!ipcResult.reached && !args.force) {
      return {
        target,
        ok: false,
        message:
          `无法通过 IPC 连接 PID=${target.pid} (agent=${target.agentName}, port=${target.port})。` +
          `这可能是残留 lock 或旧进程异常。原因: ${gracefulError instanceof Error ? gracefulError.message : String(gracefulError)}。` +
          ' 如确认要按 PID 结束它，请执行: iris stop --force',
      };
    }
  }

  // 兼容旧版本：IPC 可达但没有 server.shutdown 方法时，退回 SIGTERM。
  // 如果 IPC 完全不可达，则只有 --force 才按 PID 操作，避免误杀 PID 复用后的非 Iris 进程。
  if (ipcResult.reached || args.force) {
    try {
      process.kill(target.pid, 'SIGTERM');
      if (await waitForProcessExit(target.pid, args.timeoutMs)) {
        removeLockIfDead(target);
        return {
          target,
          ok: true,
          message: `已发送 SIGTERM 并关闭 PID=${target.pid} (agent=${target.agentName})`,
        };
      }
    } catch (err) {
      gracefulError = err;
    }
  }

  if (args.force) {
    try {
      process.kill(target.pid, 'SIGKILL');
      if (await waitForProcessExit(target.pid, Math.min(args.timeoutMs, 3_000))) {
        removeLockIfDead(target);
        return {
          target,
          ok: true,
          message: `已强制结束 PID=${target.pid} (agent=${target.agentName})`,
        };
      }
    } catch (err) {
      gracefulError = err;
    }
  }

  return {
    target,
    ok: false,
    message:
      `无法关闭 PID=${target.pid} (agent=${target.agentName})。` +
      `原因: ${gracefulError instanceof Error ? gracefulError.message : String(gracefulError)}。` +
      (args.force ? '' : ' 可重试: iris stop --force'),
  };
}

function dedupeTargetsByPid(targets: LockTarget[]): LockTarget[] {
  const seen = new Set<number>();
  const deduped: LockTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.pid)) continue;
    seen.add(target.pid);
    deduped.push(target);
  }
  return deduped;
}

export async function runStop(argv: string[]): Promise<void> {
  const args = parseStopArgs(argv);
  const targets = dedupeTargetsByPid(discoverLockTargets(args.agentName));

  if (targets.length === 0) {
    console.log(args.agentName
      ? `未找到 Iris 实例 lock 文件 (agent=${args.agentName})。`
      : '未找到 Iris 实例 lock 文件。');
    process.exit(0);
  }

  const results: StopResult[] = [];
  for (const target of targets) {
    results.push(await stopTarget(target, args));
  }

  for (const result of results) {
    console.log(`${result.ok ? '✓' : '✗'} ${result.message}`);
  }

  process.exit(results.every(r => r.ok) ? 0 : 1);
}
