/**
 * Office 文档转 PDF 模块
 *
 * 使用 LibreOffice 将 DOCX/PPTX/XLSX 转换为 PDF。
 * libreoffice-convert 为可选依赖，未安装时平滑降级到文本提取。
 */

import { execSync } from 'child_process';

let _libreOfficeAvailable: boolean | null = null;
let _npmPackageAvailable: boolean | null = null;
let _convertAsync: ((buf: Buffer, ext: string, filter: undefined) => Promise<Buffer>) | null = null;

/** 检测 LibreOffice 是否可用（结果缓存） */
export function isLibreOfficeAvailable(): boolean {
  if (_libreOfficeAvailable !== null) return _libreOfficeAvailable;
  // Windows 上可执行文件是 soffice，Linux/macOS 上是 libreoffice
  const commands = process.platform === 'win32'
    ? ['soffice --version', 'libreoffice --version']
    : ['libreoffice --version'];
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'ignore', timeout: 5000 });
      _libreOfficeAvailable = true;
      return true;
    } catch {
      // 继续尝试下一个命令
    }
  }
  _libreOfficeAvailable = false;
  return false;
}

/** 检测 libreoffice-convert npm 包是否已安装（结果缓存） */
export function isNpmPackageAvailable(): boolean {
  if (_npmPackageAvailable !== null) return _npmPackageAvailable;
  try {
    require.resolve('libreoffice-convert');
    _npmPackageAvailable = true;
  } catch {
    _npmPackageAvailable = false;
  }
  return _npmPackageAvailable;
}

/** 懒加载 libreoffice-convert，成功返回 convertAsync，失败返回 null */
async function loadConvert(): Promise<typeof _convertAsync> {
  if (_convertAsync) return _convertAsync;
  if (!isNpmPackageAvailable()) return null;
  try {
    const { promisify } = await import('util');
    const libre = await import('libreoffice-convert');
    const mod = libre.default ?? libre;
    _convertAsync = promisify(mod.convert);
    return _convertAsync;
  } catch {
    _npmPackageAvailable = false;
    return null;
  }
}

/** Office→PDF 转换是否完全可用（npm 包 + LibreOffice 二进制） */
export function isConversionAvailable(): boolean {
  return isNpmPackageAvailable() && isLibreOfficeAvailable();
}

/** Office 文档转 PDF。返回 PDF Buffer，失败返回 null */
export async function convertToPDF(buffer: Buffer, _ext: string): Promise<Buffer | null> {
  if (!isLibreOfficeAvailable()) return null;
  const convert = await loadConvert();
  if (!convert) return null;
  try {
    return await convert(buffer, '.pdf', undefined);
  } catch {
    return null;
  }
}

/** 清除缓存（安装新依赖后调用） */
export function resetAvailabilityCache(): void {
  _libreOfficeAvailable = null;
  _npmPackageAvailable = null;
  _convertAsync = null;
}
