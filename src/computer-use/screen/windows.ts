/**
 * Windows 平台 Screen 适配器
 *
 * 通过 PowerShell 调用 .NET API 实现截屏和输入模拟。
 * 无额外依赖，仅需 Windows 自带的 PowerShell 5.1+。
 *
 * 支持两种模式：
 *   - 全屏模式（默认）：截取整个屏幕，操作范围为全屏
 *   - 窗口模式（bindWindow 后）：截取指定窗口区域，坐标自动偏移到窗口位置
 *
 * 注意事项：
 *   - 通过 SetProcessDPIAware 确保高 DPI 下坐标和截图为物理像素
 *   - 通过 DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) 获取不含阴影的实际窗口区域
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ScreenAdapter } from './adapter';

const exec = promisify(execFile);

/** PowerShell 按键名映射 → SendKeys 格式 */
const SENDKEYS_MAP: Record<string, string> = {
  enter: '{ENTER}',
  return: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  space: ' ',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  insert: '{INSERT}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
  f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
  f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
};

/** 修饰键前缀映射（SendKeys 格式） */
const MODIFIER_MAP: Record<string, string> = {
  control: '^',
  ctrl: '^',
  alt: '%',
  shift: '+',
};

/**
 * 公共 PowerShell 前缀：
 *   1. 声明 DPI 感知（确保坐标和截图为物理像素）
 *   2. 加载 .NET 程序集
 *   3. 声明 P/Invoke 类型（含 DwmGetWindowAttribute）
 *
 * 每次 PowerShell 调用都是独立进程，需要重新加载。
 */
const PREAMBLE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    // ---- DPI ----
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    // ---- 鼠标 / 键盘 ----
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);

    // ---- 窗口枚举 ----
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

    // ---- 窗口位置 ----
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // ---- DWM：获取不含阴影的窗口区域 ----
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
# 声明 DPI 感知（必须在任何坐标操作之前）
[WinAPI]::SetProcessDPIAware() | Out-Null
`;

/**
 * 生成查找窗口并设置 $wx, $wy, $ww, $wh 变量的 PowerShell 代码。
 * 使用 DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS = 9) 获取不含阴影的实际窗口区域。
 * 如果 DWM 调用失败（如 Win7 未启用 Aero），回退到 GetWindowRect。
 */
function windowFindScript(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `
$_targetTitle = '${escaped}'
$_hwnd = [IntPtr]::Zero
[WinAPI]::EnumWindows({
    param($h, $l)
    if ([WinAPI]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [WinAPI]::GetWindowText($h, $sb, 256) | Out-Null
        if ($sb.ToString() -like "*$_targetTitle*") {
            $script:_hwnd = $h
            return $false
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($_hwnd -eq [IntPtr]::Zero) { throw "找不到窗口: $_targetTitle" }
[WinAPI]::ShowWindow($_hwnd, 9) | Out-Null
[WinAPI]::SetForegroundWindow($_hwnd) | Out-Null
Start-Sleep -Milliseconds 150
# 优先使用 DWM 获取不含阴影的窗口区域
$_dwmRect = New-Object WinAPI+RECT
$_hr = [WinAPI]::DwmGetWindowAttribute($_hwnd, 9, [ref]$_dwmRect, [System.Runtime.InteropServices.Marshal]::SizeOf($_dwmRect))
if ($_hr -eq 0) {
    $wx = $_dwmRect.Left; $wy = $_dwmRect.Top
    $ww = $_dwmRect.Right - $_dwmRect.Left; $wh = $_dwmRect.Bottom - $_dwmRect.Top
} else {
    # DWM 不可用，回退到 GetWindowRect（含阴影）
    $_rect = New-Object WinAPI+RECT
    [WinAPI]::GetWindowRect($_hwnd, [ref]$_rect) | Out-Null
    $wx = $_rect.Left; $wy = $_rect.Top
    $ww = $_rect.Right - $_rect.Left; $wh = $_rect.Bottom - $_rect.Top
}
`;
}

export class WindowsScreenAdapter implements ScreenAdapter {
  readonly platform = 'windows';
  private _windowTitle?: string;

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  async initialize(): Promise<void> {
    try {
      await this.ps('$PSVersionTable.PSVersion.Major');
    } catch {
      throw new Error('Windows Screen 环境需要 PowerShell 5.1+');
    }
  }

  async bindWindow(windowTitle: string): Promise<void> {
    const script = PREAMBLE + windowFindScript(windowTitle) + '"$ww,$wh"';
    const output = await this.ps(script);
    const [w, h] = output.trim().split(',').map(Number);
    if (!w || !h) throw new Error(`窗口尺寸异常: ${output.trim()}`);
    this._windowTitle = windowTitle;
  }

  async getScreenSize(): Promise<[number, number]> {
    if (this._windowTitle) {
      const script = PREAMBLE + windowFindScript(this._windowTitle) + '"$ww,$wh"';
      const output = await this.ps(script);
      const [w, h] = output.trim().split(',').map(Number);
      return [w, h];
    }
    // 全屏模式：使用 DPI-aware 后的真实分辨率
    const script = PREAMBLE + `
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"$($s.Width),$($s.Height)"
`;
    const output = await this.ps(script);
    const [w, h] = output.trim().split(',').map(Number);
    return [w, h];
  }

  async captureScreen(): Promise<Buffer> {
    if (this._windowTitle) {
      // 窗口模式：截取 DWM 返回的实际窗口区域（不含阴影）
      const script = PREAMBLE + windowFindScript(this._windowTitle) + `
$bmp = New-Object System.Drawing.Bitmap($ww, $wh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($wx, $wy, 0, 0, (New-Object System.Drawing.Size($ww, $wh)))
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
      const output = await this.ps(script);
      return Buffer.from(output.trim(), 'base64');
    }
    // 全屏模式
    const script = PREAMBLE + `
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
    const output = await this.ps(script);
    return Buffer.from(output.trim(), 'base64');
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
`;
    await this.ps(script);
  }

  async click(x: number, y: number): Promise<void> {
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }

  async doubleClick(x: number, y: number): Promise<void> {
    await this.click(x, y);
    await this.sleep(50);
    await this.click(x, y);
  }

  async rightClick(x: number, y: number): Promise<void> {
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }

  async drag(x: number, y: number, destX: number, destY: number): Promise<void> {
    const [ax, ay] = await this.toScreen(x, y);
    const [adx, ady] = await this.toScreen(destX, destY);
    const downScript = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(downScript);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(ax + (adx - ax) * i / steps);
      const cy = Math.round(ay + (ady - ay) * i / steps);
      await this.ps(PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
`);
      await this.sleep(20);
    }
    await this.ps(PREAMBLE + `[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)`);
  }

  async typeText(text: string): Promise<void> {
    const escaped = text.replace(/'/g, "''");
    const script = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Start-Sleep -Milliseconds 50
[WinAPI]::keybd_event(0x11, 0, 0, [IntPtr]::Zero)  # Ctrl down
[WinAPI]::keybd_event(0x56, 0, 0, [IntPtr]::Zero)  # V down
[WinAPI]::keybd_event(0x56, 0, 2, [IntPtr]::Zero)  # V up
[WinAPI]::keybd_event(0x11, 0, 2, [IntPtr]::Zero)  # Ctrl up
`;
    await this.ps(script);
  }

  async keyPress(key: string): Promise<void> {
    await this.keyCombination([key]);
  }

  async keyCombination(keys: string[]): Promise<void> {
    let prefix = '';
    let mainKey = '';
    for (const k of keys) {
      const lower = k.toLowerCase();
      const mod = MODIFIER_MAP[lower];
      if (mod) {
        prefix += mod;
      } else {
        mainKey = SENDKEYS_MAP[lower] ?? k;
      }
    }
    const combo = prefix + mainKey;
    const escaped = combo.replace(/'/g, "''");
    const script = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
    await this.ps(script);
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    const [ax, ay] = await this.toScreen(x, y);
    const wheelDelta = -deltaY;
    let scrollScript = PREAMBLE
      + (this._windowTitle ? windowFindScript(this._windowTitle) : '')
      + `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})\n`;
    if (wheelDelta !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x0800, 0, 0, ${wheelDelta * 120}, [IntPtr]::Zero)\n`;
    }
    if (deltaX !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x01000, 0, 0, ${deltaX * 120}, [IntPtr]::Zero)\n`;
    }
    await this.ps(scrollScript);
  }

  async openUrl(url: string): Promise<void> {
    const escaped = url.replace(/'/g, "''");
    await this.ps(`Start-Process '${escaped}'`);
  }

  // ============ 内部 ============

  /**
   * 将窗口内相对坐标转为屏幕绝对坐标。
   * 全屏模式下直接返回原值。
   * 窗口模式下通过 DWM 获取窗口位置后加偏移。
   */
  private async toScreen(x: number, y: number): Promise<[number, number]> {
    if (!this._windowTitle) return [x, y];
    const script = PREAMBLE + windowFindScript(this._windowTitle) + '"$wx,$wy"';
    const output = await this.ps(script);
    const [wx, wy] = output.trim().split(',').map(Number);
    return [wx + x, wy + y];
  }

  private async ps(script: string): Promise<string> {
    const { stdout } = await exec('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { timeout: 15_000 });
    return stdout;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
