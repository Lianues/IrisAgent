#!/usr/bin/env node

/**
 * 一键编译所有 extension 的 TypeScript 源码。
 *
 * 工作原理：
 *   扫描 extensions/ 下所有子目录，找到 package.json 中含有 build 脚本的 extension，
 *   依次在其目录下执行 `bun run build`。
 *
 * 支持的命令行参数：
 *   --embedded-only   只编译 embedded.json 中列出的内嵌 extension
 *   --filter <name>   只编译指定名称的 extension（可多次使用）
 *
 * 用法：
 *   npm run build:extensions              # 编译全部
 *   npm run build:extensions -- --filter lark --filter web   # 只编译 lark 和 web
 *   npm run build:extensions -- --embedded-only              # 只编译内嵌 extension
 */

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionsDir = path.join(rootDir, 'extensions');
const embeddedConfigPath = path.join(extensionsDir, 'embedded.json');

interface EmbeddedConfig {
  extensions?: Array<{ name?: string }>;
}

interface ParsedArgs {
  embeddedOnly: boolean;
  filters: string[];
}

// ---------- 工具函数 ----------

/** 读取 embedded.json，获取内嵌 extension 名称白名单 */
function loadEmbeddedExtensionNames(): Set<string> {
  if (!fs.existsSync(embeddedConfigPath)) return new Set<string>();
  const raw = JSON.parse(fs.readFileSync(embeddedConfigPath, 'utf8')) as EmbeddedConfig;
  return new Set(
    (raw.extensions ?? [])
      .map((item) => String(item?.name ?? '').trim())
      .filter(Boolean),
  );
}

/** 解析命令行参数 */
function parseArgs(args: string[]): ParsedArgs {
  const filters: string[] = [];
  let embeddedOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--embedded-only') {
      embeddedOnly = true;
    } else if (args[i] === '--filter' && i + 1 < args.length) {
      filters.push(args[++i]);
    }
  }
  return { embeddedOnly, filters };
}

/** 收集需要编译的 extension 目录列表 */
function listBuildableExtensions(options: ParsedArgs): { name: string; dir: string }[] {
  const embeddedNames = loadEmbeddedExtensionNames();
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: path.join(extensionsDir, entry.name) }))
    .filter(({ name, dir }) => {
      // 必须有 package.json
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) return false;
      // package.json 里必须有 build 脚本
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!pkg.scripts?.build) return false;
      // --embedded-only 过滤
      if (options.embeddedOnly && !embeddedNames.has(name)) return false;
      // --filter 过滤
      if (options.filters.length > 0 && !options.filters.includes(name)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 在指定目录下执行 bun run build */
function runBuild(extensionDir: string): { success: boolean; error?: string } {
  // 优先使用 bun（所有 extension 的 build 脚本都是 bun build 命令）
  // 回退到 npm run build 以兼容没有 bun 的环境
  const command = 'bun';
  const args = ['run', 'build'];
  const result = childProcess.spawnSync(command, args, {
    cwd: extensionDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    return { success: false, error: result.error.message };
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return { success: false, error: `exit code ${result.status}` };
  }
  return { success: true };
}

// ---------- 主流程 ----------

/**
 * 前置步骤：编译 irises-extension-sdk。
 * 很多 extension 依赖这个包的编译产物（dist/），如果跳过会导致
 * bun build 时报 "Could not resolve irises-extension-sdk" 错误。
 */
function buildExtensionSdk(): boolean {
  const sdkDir = path.join(rootDir, 'packages', 'extension-sdk');
  const pkgPath = path.join(sdkDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log('[build] packages/extension-sdk 不存在，跳过 SDK 编译');
    return true;
  }
  console.log('[build] 编译 irises-extension-sdk ...');
  const result = childProcess.spawnSync('npm', ['run', 'build'], {
    cwd: sdkDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
    console.error('[build] irises-extension-sdk 编译失败，后续 extension 可能也会失败');
    return false;
  }
  console.log('[build] irises-extension-sdk 编译成功\n');
  return true;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const extensions = listBuildableExtensions(options);

  if (extensions.length === 0) {
    console.log('未找到需要编译的 extension');
    return;
  }

  // 先编译 extension-sdk，它是多数 extension 的编译期依赖
  buildExtensionSdk();

  console.log(`准备编译 ${extensions.length} 个 extension...\n`);

  const failed: string[] = [];
  const succeeded: string[] = [];

  for (const ext of extensions) {
    console.log(`[build] ${ext.name}`);
    const result = runBuild(ext.dir);
    if (result.success) {
      succeeded.push(ext.name);
    } else {
      console.warn(`[build] ${ext.name} 编译失败: ${result.error}`);
      failed.push(ext.name);
    }
  }

  // 汇总
  console.log(`\n编译完成: ${succeeded.length} 成功, ${failed.length} 失败`);
  if (failed.length > 0) {
    console.log('失败的 extension:');
    failed.forEach((name) => console.log(`  - ${name}`));
    process.exit(1);
  }
}

main();
