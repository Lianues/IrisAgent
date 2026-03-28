import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createdDirs: string[] = [];
const originalIrisDataDir = process.env.IRIS_DATA_DIR;

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.IRIS_DATA_DIR = originalIrisDataDir;
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe('extension priority order', () => {
  it('同名 extension 应优先使用 ~/.iris/extensions/ 中已安装的版本，而不是源码内嵌版本', async () => {
    const runtimeDataDir = createTempDir('iris-extension-priority-runtime-');
    process.env.IRIS_DATA_DIR = runtimeDataDir;
    vi.resetModules();

    const { extensionsDir, workspaceExtensionsDir } = await import('../src/paths.js');
    const { discoverLocalExtensions, resolveLocalPluginSource } = await import('../src/extension/index.js');

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const name = `priority-extension-${suffix}`;
    const installedDir = path.join(extensionsDir, name);
    const workspaceDir = path.join(workspaceExtensionsDir, name);
    createdDirs.push(workspaceDir);

    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'manifest.json'), JSON.stringify({
      name,
      version: '9.9.9',
      plugin: { entry: 'installed.mjs' },
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(installedDir, 'installed.mjs'), 'export default {};\n', 'utf8');

    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'manifest.json'), JSON.stringify({
      name,
      version: '0.1.0',
      plugin: { entry: 'workspace.mjs' },
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(workspaceDir, 'workspace.mjs'), 'export default {};\n', 'utf8');

    const packages = discoverLocalExtensions();
    const resolvedPackage = packages.find((item) => item.manifest.name === name);
    const localPlugin = resolveLocalPluginSource(name, packages);

    expect(resolvedPackage?.source).toBe('installed');
    expect(resolvedPackage?.manifest.version).toBe('9.9.9');
    expect(localPlugin.rootDir).toBe(installedDir);
    expect(localPlugin.entryFile).toBe(path.join(installedDir, 'installed.mjs'));
  });
});
