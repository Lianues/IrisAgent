import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExtension, installGitExtension, installLocalExtension, updateGitExtension, type GitCommandRunner } from 'irises-extension-sdk/utils';

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

function createMockGitRunner(writer: (cloneDir: string) => void): GitCommandRunner {
  return vi.fn(async (_command: string, args: string[]) => {
    const action = args[0];
    if (action === 'clone') {
      const cloneDir = args[args.length - 1];
      writer(cloneDir);
      return { stdout: '' };
    }
    if (action === 'fetch' || action === 'checkout') {
      return { stdout: '' };
    }
    if (action === 'rev-parse') {
      return { stdout: 'abc123def456\n' };
    }
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  });
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

  it('install-git 支持按 Git URL/ref/subdir 安装发行包并写入来源元数据', async () => {
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const commandRunner = createMockGitRunner((cloneDir) => {
      const extensionDir = path.join(cloneDir, 'extensions', 'demo');
      writeJson(path.join(extensionDir, 'manifest.json'), {
        name: 'git-demo-extension',
        version: '1.0.0',
        plugin: { entry: 'dist/index.mjs' },
      });
      writeText(path.join(extensionDir, 'dist', 'index.mjs'), 'export default {};\n');
      writeText(path.join(extensionDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      writeText(path.join(extensionDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = {};\n');
    });

    const result = await installGitExtension('https://github.com/acme/iris-demo.git#v1.0.0:extensions/demo', {
      installedExtensionsDir,
      commandRunner,
    });

    expect(result.source).toBe('git');
    expect(result.name).toBe('git-demo-extension');
    expect(result.gitUrl).toBe('https://github.com/acme/iris-demo.git');
    expect(result.gitRef).toBe('v1.0.0');
    expect(result.gitSubdir).toBe('extensions/demo');
    expect(result.gitCommit).toBe('abc123def456');
    expect(fs.existsSync(path.join(result.targetDir, 'dist', 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.targetDir, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(result.targetDir, 'node_modules'))).toBe(false);

    const metadata = JSON.parse(fs.readFileSync(path.join(result.targetDir, '.iris-extension-install.json'), 'utf-8'));
    expect(metadata).toMatchObject({
      source: 'git',
      url: 'https://github.com/acme/iris-demo.git',
      ref: 'v1.0.0',
      commit: 'abc123def456',
      subdir: 'extensions/demo',
    });
  });

  it('update 应按已记录的 Git 来源升级并保留禁用标记', async () => {
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const makeRunner = (version: string, commit: string): GitCommandRunner => vi.fn(async (_command: string, args: string[]) => {
      const action = args[0];
      if (action === 'clone') {
        const cloneDir = args[args.length - 1];
        const extensionDir = path.join(cloneDir, 'extensions', 'demo');
        writeJson(path.join(extensionDir, 'manifest.json'), {
          name: 'git-demo-extension',
          version,
          plugin: { entry: 'dist/index.mjs' },
        });
        writeText(path.join(extensionDir, 'dist', 'index.mjs'), `export default { version: ${JSON.stringify(version)} };\n`);
        return { stdout: '' };
      }
      if (action === 'fetch' || action === 'checkout') return { stdout: '' };
      if (action === 'rev-parse') return { stdout: `${commit}\n` };
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });

    const installed = await installGitExtension('https://github.com/acme/iris-demo.git#main:extensions/demo', {
      installedExtensionsDir,
      commandRunner: makeRunner('1.0.0', 'oldcommit'),
    });
    fs.writeFileSync(path.join(installed.targetDir, '.disabled'), 'disabled\n', 'utf8');
    const initialMetadata = JSON.parse(fs.readFileSync(path.join(installed.targetDir, '.iris-extension-install.json'), 'utf-8'));

    const updated = await updateGitExtension('git-demo-extension', {
      installedExtensionsDir,
      commandRunner: makeRunner('1.1.0', 'newcommit'),
    });

    expect(updated.version).toBe('1.1.0');
    expect(updated.gitCommit).toBe('newcommit');
    expect(fs.existsSync(path.join(updated.targetDir, '.disabled'))).toBe(true);
    expect(fs.readFileSync(path.join(updated.targetDir, 'dist', 'index.mjs'), 'utf-8')).toContain('1.1.0');

    const metadata = JSON.parse(fs.readFileSync(path.join(updated.targetDir, '.iris-extension-install.json'), 'utf-8'));
    expect(metadata).toMatchObject({
      source: 'git',
      url: 'https://github.com/acme/iris-demo.git',
      ref: 'main',
      commit: 'newcommit',
      subdir: 'extensions/demo',
      installedAt: initialMetadata.installedAt,
    });
    expect(typeof metadata.updatedAt).toBe('string');
  });
});