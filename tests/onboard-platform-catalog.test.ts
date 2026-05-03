import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAvailableOnboardPlatforms } from '../terminal/src/commands/onboard/utils/platform-catalog.js';

const createdDirs: string[] = [];
const originalIrisDataDir = process.env.IRIS_DATA_DIR;

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

afterEach(() => {
  process.env.IRIS_DATA_DIR = originalIrisDataDir;
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('onboard platform catalog', () => {
  it('除内置平台外，应从 extension manifest 读取平台名称、描述和 panel 字段', () => {
    const installDir = createTempDir('iris-onboard-install-');
    const runtimeDataDir = createTempDir('iris-onboard-runtime-');
    process.env.IRIS_DATA_DIR = runtimeDataDir;

    writeJson(path.join(installDir, 'extensions', 'telegram', 'manifest.json'), {
      name: 'telegram',
      version: '0.1.0',
      description: 'Telegram extension',
      platforms: [
        {
          name: 'telegram',
          label: 'Telegram Bot',
          entry: 'dist/index.mjs',
          description: 'Telegram 机器人，来自 manifest。',
          panel: {
            description: '填写 Telegram 配置。',
            fields: [
              {
                key: 'token',
                type: 'password',
                label: 'Telegram Token',
                example: '123456:ABC',
                required: true,
              },
            ],
          },
        },
      ],
    });

    writeJson(path.join(runtimeDataDir, 'extensions', 'custom-chat', 'manifest.json'), {
      name: 'custom-chat',
      version: '0.1.0',
      description: 'Custom chat extension',
      platforms: [
        {
          name: 'custom-chat',
          label: 'Custom Chat',
          entry: 'dist/index.mjs',
          description: '自定义平台，来自已安装 extension。',
        },
      ],
    });

    const platforms = loadAvailableOnboardPlatforms(installDir);

    expect(platforms.map((item) => item.value)).toEqual([
      'console',
      'web',
      'headless',
      'custom-chat',
      'telegram',
    ]);

    expect(platforms.find((item) => item.value === 'telegram')).toMatchObject({
      label: 'Telegram Bot',
      desc: 'Telegram 机器人，来自 manifest。',
      source: 'extension',
      panelDescription: '填写 Telegram 配置。',
      panelFields: [
        {
          key: 'token',
          configKey: 'token',
          type: 'password',
          label: 'Telegram Token',
          example: '123456:ABC',
          required: true,
        },
      ],
    });

    expect(platforms.find((item) => item.value === 'custom-chat')).toMatchObject({
      label: 'Custom Chat',
      desc: '自定义平台，来自已安装 extension。',
      source: 'extension',
      panelFields: [],
    });
  });
});
