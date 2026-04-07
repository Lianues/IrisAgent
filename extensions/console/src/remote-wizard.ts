/**
 * 远程连接交互向导
 *
 * /remote 命令触发，在 Console TUI 暂停后全屏显示。
 * 三阶段流程：选择列表 → 输入字段 → 保存提示。
 */

import { ICONS } from './terminal-compat';

const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  clear: `${CSI}2J${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  cyan: `${CSI}36m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  red: `${CSI}31m`,
  magenta: `${CSI}35m`,
  white: `${CSI}37m`,
};

// ============ 类型 ============

export interface SavedConnection {
  name: string;
  url: string;
  hasToken: boolean;
}

export interface DiscoveredConnection {
  name: string;
  host: string;
  port: number;
  agent?: string;
}

export interface WizardOptions {
  saved: SavedConnection[];
  discoveryPromise?: Promise<DiscoveredConnection[]>;
  onDelete?: (name: string) => void;
}

export type WizardResult = {
  url: string;
  token: string;
  source: 'saved' | 'discovered' | 'manual';
  savedName?: string;
} | null;

// ============ 阶段 1：选择列表 ============

function showSelectionPhase(options: WizardOptions): Promise<
  | { action: 'connect-saved'; name: string; url: string; hasToken: boolean }
  | { action: 'connect-discovered'; host: string; port: number; name: string }
  | { action: 'manual' }
  | null
> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    let discovered: DiscoveredConnection[] = [];
    let discoveryDone = false;
    let done = false; // 防止 cleanup 后继续渲染

    type ListItem =
      | { type: 'saved'; name: string; url: string; hasToken: boolean }
      | { type: 'discovered'; host: string; port: number; name: string }
      | { type: 'manual' };

    function buildItems(): ListItem[] {
      const items: ListItem[] = [];
      for (const s of options.saved) {
        items.push({ type: 'saved', name: s.name, url: s.url, hasToken: s.hasToken });
      }
      for (const d of discovered) {
        items.push({ type: 'discovered', host: d.host, port: d.port, name: d.name });
      }
      items.push({ type: 'manual' });
      return items;
    }

    let items = buildItems();
    let cursor = 0;

    // 启动发现
    if (options.discoveryPromise) {
      options.discoveryPromise.then((results) => {
        if (done) return; // 用户已取消，不再渲染
        discovered = results;
        discoveryDone = true;
        items = buildItems();
        if (cursor >= items.length) cursor = items.length - 1;
        render();
      }).catch(() => {
        if (done) return;
        discoveryDone = true;
        render();
      });
    } else {
      discoveryDone = true;
    }

    function render() {
      if (done) return;
      const lines: string[] = [];
      lines.push('');
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 远程连接 ${ansi.reset}`);
      lines.push('');

      // 已保存
      if (options.saved.length > 0) {
        lines.push(`  ${ansi.dim}已保存:${ansi.reset}`);
        for (let i = 0; i < options.saved.length; i++) {
          const s = options.saved[i];
          const isCurrent = cursor === i;
          const arrow = isCurrent ? `${ansi.cyan}${ICONS.triangleRight} ` : '  ';
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${s.name}${ansi.reset}` : s.name;
          const host = s.url.replace(/^wss?:\/\//, '');
          const tokenHint = s.hasToken ? `${ansi.dim} ${ICONS.checkmark}${ansi.reset}` : '';
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${host})${ansi.reset}${tokenHint}`);
        }
        lines.push('');
      }

      // 局域网发现
      const savedLen = options.saved.length;
      if (!discoveryDone) {
        lines.push(`  ${ansi.dim}局域网: ${ansi.yellow}搜索中...${ansi.reset}`);
        lines.push('');
      } else if (discovered.length > 0) {
        lines.push(`  ${ansi.dim}局域网发现:${ansi.reset}`);
        for (let i = 0; i < discovered.length; i++) {
          const d = discovered[i];
          const idx = savedLen + i;
          const isCurrent = cursor === idx;
          const arrow = isCurrent ? `${ansi.cyan}${ICONS.triangleRight} ` : '  ';
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${d.name}${ansi.reset}` : d.name;
          const agentHint = d.agent ? ` [${d.agent}]` : '';
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${d.host}:${d.port}${agentHint})${ansi.reset}`);
        }
        lines.push('');
      } else {
        lines.push(`  ${ansi.dim}局域网: 未发现其他实例${ansi.reset}`);
        lines.push('');
      }

      // 手动输入
      const manualIdx = items.length - 1;
      const isManualCurrent = cursor === manualIdx;
      const manualStyle = isManualCurrent
        ? `${ansi.cyan}${ansi.bold}${ICONS.triangleRight} [ 手动输入 ]${ansi.reset}`
        : `  ${ansi.dim}[ 手动输入 ]${ansi.reset}`;
      lines.push(`  ${manualStyle}`);
      lines.push('');

      // 提示
      const hints = ['↑↓ 选择', 'Enter 连接'];
      if (options.saved.length > 0 && cursor < savedLen) {
        hints.push('d 删除');
      }
      hints.push('Esc 取消');
      lines.push(`  ${ansi.dim}${hints.join(`  ${ICONS.separator}  `)}${ansi.reset}`);
      lines.push('');

      stdout.write(ansi.clear + ansi.hideCursor + lines.join('\n'));
    }

    function cleanup() {
      done = true;
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }

    function onData(buf: Buffer) {
      const key = buf.toString('utf-8');

      // Esc / Ctrl+C → 取消
      if (key === '\x1b' || key === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // 上箭头
      if (key === '\x1b[A') {
        if (cursor > 0) cursor--;
        render();
        return;
      }

      // 下箭头
      if (key === '\x1b[B') {
        if (cursor < items.length - 1) cursor++;
        render();
        return;
      }

      // Tab → 下一项（循环）
      if (key === '\t') {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }

      // Shift+Tab
      if (key === '\x1b[Z') {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }

      // d → 删除（仅已保存的连接）
      if (key === 'd' || key === 'D') {
        const item = items[cursor];
        if (item?.type === 'saved' && options.onDelete) {
          try { options.onDelete(item.name); } catch {}
          options.saved = options.saved.filter((s) => s.name !== item.name);
          items = buildItems();
          if (cursor >= items.length) cursor = items.length - 1;
          render();
        }
        return;
      }

      // Enter → 选择
      if (key === '\r' || key === '\n') {
        const item = items[cursor];
        if (!item) return;
        cleanup();
        if (item.type === 'saved') {
          resolve({ action: 'connect-saved', name: item.name, url: item.url, hasToken: item.hasToken });
        } else if (item.type === 'discovered') {
          resolve({ action: 'connect-discovered', host: item.host, port: item.port, name: item.name });
        } else {
          resolve({ action: 'manual' });
        }
        return;
      }
    }

    stdin.on('data', onData);
    render();
  });
}

// ============ 阶段 2：输入字段 ============

export interface InputPhaseOptions {
  prefillUrl?: string;
  prefillToken?: string;
  /** 是否锁定 URL（从已保存或发现中选择时） */
  urlLocked?: boolean;
}

/**
 * 显示 URL + Token 输入界面。
 * 导出供快捷连接（/remote <name>）时直接调用。
 */
export function showInputPhase(opts: InputPhaseOptions = {}): Promise<{ url: string; token: string } | null> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    let url = opts.prefillUrl || 'ws://';
    let token = opts.prefillToken || '';
    /** 0 = URL, 1 = Token, 2 = 连接按钮 */
    let focusedField = opts.urlLocked ? 1 : 0;
    let status = '';
    let statusIsError = false;

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    function render() {
      const lines: string[] = [];
      lines.push('');
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 远程连接 ${ansi.reset}`);
      lines.push('');

      // URL field
      if (opts.urlLocked) {
        lines.push(`  ${ansi.dim}地址${ansi.reset}  ${url}`);
      } else {
        const urlLabel = focusedField === 0 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
        const urlCursor = focusedField === 0 ? `${ansi.cyan}|${ansi.reset}` : '';
        lines.push(`  ${urlLabel}地址${ansi.reset}  ${url}${urlCursor}`);
      }
      lines.push('');

      // Token field
      const tokenLabel = focusedField === 1 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
      const tokenCursor = focusedField === 1 ? `${ansi.cyan}|${ansi.reset}` : '';
      const maskedToken = '*'.repeat(token.length);
      lines.push(`  ${tokenLabel}Token${ansi.reset} ${maskedToken}${tokenCursor}`);
      lines.push('');

      // Button
      const connectStyle = focusedField === 2
        ? `${ansi.green}${ansi.bold}[ 连接 ]${ansi.reset}`
        : `${ansi.dim}[ 连接 ]${ansi.reset}`;
      lines.push(`  ${connectStyle}`);
      lines.push('');

      // Status
      if (status) {
        const statusColor = statusIsError ? ansi.red : ansi.green;
        lines.push(`  ${statusColor}${status}${ansi.reset}`);
        lines.push('');
      }

      lines.push(`  ${ansi.dim}Tab 切换字段  Enter 确认  Esc 返回${ansi.reset}`);
      lines.push('');

      stdout.write(ansi.clear + ansi.hideCursor + lines.join('\n'));
    }

    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }

    const fieldCount = 3;
    function nextField() {
      if (opts.urlLocked) {
        focusedField = focusedField === 1 ? 2 : 1;
      } else {
        focusedField = (focusedField + 1) % fieldCount;
      }
    }
    function prevField() {
      if (opts.urlLocked) {
        focusedField = focusedField === 1 ? 2 : 1;
      } else {
        focusedField = (focusedField - 1 + fieldCount) % fieldCount;
      }
    }

    function onData(buf: Buffer) {
      const key = buf.toString('utf-8');

      if (key === '\x1b' || key === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      if (key === '\t') { nextField(); render(); return; }
      if (key === '\x1b[Z') { prevField(); render(); return; }

      if (key === '\r' || key === '\n') {
        if (focusedField === 2) {
          if (!url.trim() || url.trim() === 'ws://') {
            status = '请输入远程地址'; statusIsError = true; render(); return;
          }
          if (!token.trim()) {
            status = '请输入 Token'; statusIsError = true; render(); return;
          }
          cleanup();
          resolve({ url: url.trim(), token: token.trim() });
          return;
        }
        nextField(); render(); return;
      }

      if (key === '\x7f' || key === '\b') {
        if (focusedField === 0 && !opts.urlLocked && url.length > 0) url = url.slice(0, -1);
        else if (focusedField === 1 && token.length > 0) token = token.slice(0, -1);
        status = ''; render(); return;
      }

      if (key === '\x1b[A') { prevField(); render(); return; }
      if (key === '\x1b[B') { nextField(); render(); return; }

      if (key.length === 1 && key >= ' ') {
        if (focusedField === 0 && !opts.urlLocked) url += key;
        else if (focusedField === 1) token += key;
        status = ''; render(); return;
      }
    }

    stdin.on('data', onData);
    render();
  });
}

// ============ 阶段 3：保存提示 ============

export function showSavePrompt(): Promise<string | null> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    let name = '';
    let status = '';

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    function render() {
      const lines: string[] = [];
      lines.push('');
      lines.push(`  ${ansi.green}${ansi.bold}${ICONS.checkmark} 已连接到远程 Iris${ansi.reset}`);
      lines.push('');
      lines.push(`  ${ansi.dim}保存此连接？输入名称后回车保存，Esc 跳过${ansi.reset}`);
      lines.push('');
      lines.push(`  ${ansi.cyan}${ansi.bold}名称${ansi.reset} ${name}${ansi.cyan}|${ansi.reset}`);
      lines.push('');
      if (status) {
        lines.push(`  ${ansi.red}${status}${ansi.reset}`);
        lines.push('');
      }

      stdout.write(ansi.clear + ansi.hideCursor + lines.join('\n'));
    }

    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }

    function onData(buf: Buffer) {
      const key = buf.toString('utf-8');

      if (key === '\x1b' || key === '\x03') {
        cleanup(); resolve(null); return;
      }

      if (key === '\r' || key === '\n') {
        const trimmed = name.trim();
        if (!trimmed) {
          status = '请输入连接名称'; render(); return;
        }
        if (!/^[\w-]+$/.test(trimmed)) {
          status = '名称只能包含字母、数字、-、_'; render(); return;
        }
        cleanup(); resolve(trimmed); return;
      }

      if (key === '\x7f' || key === '\b') {
        if (name.length > 0) name = name.slice(0, -1);
        status = ''; render(); return;
      }

      if (key.length === 1 && key >= ' ') {
        name += key; status = ''; render(); return;
      }
    }

    stdin.on('data', onData);
    render();
  });
}

// ============ 主入口 ============

/**
 * 显示远程连接向导（三阶段）
 *
 * @returns 用户选择的连接信息，取消时返回 null。
 */
export async function showRemoteConnectWizard(options: WizardOptions): Promise<WizardResult> {
  // 如果没有任何已保存连接且没有发现 promise，直接进入输入阶段
  const hasListItems = options.saved.length > 0 || options.discoveryPromise;

  if (!hasListItems) {
    const input = await showInputPhase();
    if (!input) return null;
    return { url: input.url, token: input.token, source: 'manual' };
  }

  // 阶段 1：选择列表
  const selection = await showSelectionPhase(options);
  if (!selection) return null;

  if (selection.action === 'connect-saved') {
    if (selection.hasToken) {
      // 已保存且有 token → 直接连接（token 由调用方从 config 读取）
      return { url: selection.url, token: '', source: 'saved', savedName: selection.name };
    }
    // 已保存但无 token → 输入阶段（URL 预填且锁定）
    const input = await showInputPhase({ prefillUrl: selection.url, urlLocked: true });
    if (!input) return null;
    return { url: input.url, token: input.token, source: 'saved', savedName: selection.name };
  }

  if (selection.action === 'connect-discovered') {
    const url = `ws://${selection.host}:${selection.port}`;
    const input = await showInputPhase({ prefillUrl: url, urlLocked: true });
    if (!input) return null;
    return { url: input.url, token: input.token, source: 'discovered' };
  }

  // 手动输入
  const input = await showInputPhase();
  if (!input) return null;
  return { url: input.url, token: input.token, source: 'manual' };
}

// ============ 连接状态显示 ============

export function showConnectingStatus(url: string): void {
  process.stdout.write(
    ansi.clear +
    `\n  ${ansi.cyan}正在连接到 ${url}...${ansi.reset}\n`
  );
}

export function showConnectSuccess(agentName: string, modelName: string): void {
  process.stdout.write(
    `  ${ansi.green}已连接到远程 Iris (agent=${agentName}, model=${modelName})${ansi.reset}\n`
  );
}

export function showConnectError(error: string): void {
  process.stdout.write(
    `  ${ansi.red}连接失败: ${error}${ansi.reset}\n`
  );
}
