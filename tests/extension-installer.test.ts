import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseExtensionCommandArgs } from '../src/extension/command.js';
import { installExtension, installLocalExtension } from '../src/extension/installer.js';

const createdDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf-8');
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetchWithMap(map: Record<string, Response>) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : String(input?.url ?? input);
    return map[url] ?? new Response('not found', { status: 404, statusText: 'Not Found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extension installer', () => {
  it('install-local 支持按本地目录名安装，并按 manifest.name 写入目标目录', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const sourceDir = path.join(localExtensionsDir, 'folder-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'demo-extension',
      version: '0.1.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');

    const result = await installLocalExtension('folder-demo', {
      localExtensionsDir,
      installedExtensionsDir,
    });

    expect(result.source).toBe('local');
    expect(result.name).toBe('demo-extension');
    expect(result.targetDir).toBe(path.join(installedExtensionsDir, 'demo-extension'));
    expect(fs.existsSync(path.join(installedExtensionsDir, 'demo-extension', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedExtensionsDir, 'demo-extension', 'index.mjs'))).toBe(true);
  });

  it('install-local 不复制源目录中的 node_modules', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const sourceDir = path.join(localExtensionsDir, 'copy-filter-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'copy-filter-demo',
      version: '0.1.0',
      platforms: [
        { name: 'copy-filter-demo', entry: 'dist/index.mjs' },
      ],
    });
    writeJson(path.join(sourceDir, 'package.json'), {
      name: '@iris-extension/copy-filter-demo',
      version: '0.1.0',
    });
    writeText(path.join(sourceDir, 'dist', 'index.mjs'), 'export default {};\n');
    writeText(path.join(sourceDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = () => {};\n');

    const result = await installLocalExtension('copy-filter-demo', {
      localExtensionsDir,
      installedExtensionsDir,
    });

    expect(result.source).toBe('local');
    expect(fs.existsSync(path.join(result.targetDir, 'node_modules'))).toBe(false);
  });

  it('install-local 遇到 source-first extension 时直接报错，要求预构建发行包', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const sourceDir = path.join(localExtensionsDir, 'source-first-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'source-first-demo',
      version: '0.1.0',
      platforms: [
        { name: 'source-first-demo', entry: 'dist/index.mjs' },
      ],
    });
    writeJson(path.join(sourceDir, 'package.json'), {
      name: '@iris-extension/source-first-demo',
      version: '0.1.0',
      scripts: { build: 'echo build' },
      dependencies: { 'irises-extension-sdk': 'file:../../packages/extension-sdk' },
    });
    writeText(path.join(sourceDir, 'src', 'index.ts'), 'export default {};\n');

    await expect(installLocalExtension('source-first-demo', {
      localExtensionsDir,
      installedExtensionsDir,
    })).rejects.toThrow('这不是可直接安装的发行包');
    expect(fs.existsSync(path.join(installedExtensionsDir, 'source-first-demo'))).toBe(false);
  });

  it('install 默认应按远程 index 与 manifest.distribution.files 只下载目标 extension 文件夹', async () => {
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteIndexUrl = 'https://example.com/extensions/index.json';
    const remoteRawBaseUrl = 'https://example.com/raw';

    const fetchMock = mockFetchWithMap({
      [remoteIndexUrl]: jsonResponse({
        extensions: ['community/demo-extension', 'another-extension'],
      }),
      [`${remoteRawBaseUrl}/extensions/community/demo-extension/manifest.json`]: new Response(JSON.stringify({
        name: 'remote-demo-extension',
        version: '1.2.3',
        platforms: [
          { name: 'remote-demo-extension', entry: 'dist/index.mjs' },
        ],
        distribution: {
          files: ['dist/index.mjs', 'assets/readme.md'],
        },
      }, null, 2), { status: 200 }),
      [`${remoteRawBaseUrl}/extensions/community/demo-extension/dist/index.mjs`]: new Response('export default {};\n', { status: 200 }),
      [`${remoteRawBaseUrl}/extensions/community/demo-extension/assets/readme.md`]: new Response('# demo\n', { status: 200 }),
    });

    const result = await installExtension('community/demo-extension', {
      remoteIndexUrl,
      remoteRawBaseUrl,
      installedExtensionsDir,
    });
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.source).toBe('remote');
    expect(result.remotePath).toBe('extensions/community/demo-extension');
    expect(result.name).toBe('remote-demo-extension');
    expect(result.targetDir).toBe(path.join(installedExtensionsDir, 'remote-demo-extension'));
    expect(fs.existsSync(path.join(result.targetDir, 'dist', 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.targetDir, 'assets', 'readme.md'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('another-extension') && url !== remoteIndexUrl)).toBe(false);
  });

  it('install 在远程目录不存在时会回退到本地安装', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteIndexUrl = 'https://example.com/extensions/index.json';
    const sourceDir = path.join(localExtensionsDir, 'fallback-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'fallback-demo',
      version: '0.3.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');
    mockFetchWithMap({
      [remoteIndexUrl]: jsonResponse({
        extensions: ['another-extension'],
      }),
    });

    const result = await installExtension('fallback-demo', {
      remoteIndexUrl,
      localExtensionsDir,
      installedExtensionsDir,
    });

    expect(result.source).toBe('local');
    expect(result.fallbackReason).toBe('remote_path_not_found');
    expect(result.fallbackDetail).toContain('extensions/fallback-demo');
    expect(fs.existsSync(path.join(installedExtensionsDir, 'fallback-demo', 'manifest.json'))).toBe(true);
  });

  it('install 在远程仓库不可用时直接报错，不回退到本地安装', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteIndexUrl = 'https://example.com/extensions/index.json';
    const sourceDir = path.join(localExtensionsDir, 'fallback-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'fallback-demo',
      version: '0.3.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');

    mockFetchWithMap({
      [remoteIndexUrl]: new Response('not found', { status: 404, statusText: 'Not Found' }),
    });

    await expect(installExtension('fallback-demo', {
      remoteIndexUrl,
      localExtensionsDir,
      installedExtensionsDir,
    })).rejects.toThrow('远程 extension 仓库不可用');
    expect(fs.existsSync(path.join(installedExtensionsDir, 'fallback-demo', 'manifest.json'))).toBe(false);
  });
});

describe('extension command parser', () => {
  it('支持 ext 的最简写法与 install-local 子命令', () => {
    expect(parseExtensionCommandArgs(['ext', 'community/demo-extension'])).toEqual({
      namespace: 'ext',
      action: 'install',
      target: 'community/demo-extension',
    });

    expect(parseExtensionCommandArgs(['extension', 'install-local', 'demo-extension'])).toEqual({
      namespace: 'extension',
      action: 'install-local',
      target: 'demo-extension',
    });
  });
});
