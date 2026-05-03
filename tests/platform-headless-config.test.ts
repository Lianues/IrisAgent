import { afterEach, describe, expect, it } from 'vitest';
import { parsePlatformConfig } from '../src/config/platform';

const originalIrisPlatform = process.env.IRIS_PLATFORM;

afterEach(() => {
  if (originalIrisPlatform === undefined) {
    delete process.env.IRIS_PLATFORM;
  } else {
    process.env.IRIS_PLATFORM = originalIrisPlatform;
  }
});

describe('parsePlatformConfig headless aliases', () => {
  it('将 headless/core/none/daemon 解析为零平台', () => {
    for (const alias of ['headless', 'core', 'none', 'daemon']) {
      expect(parsePlatformConfig({ type: alias }).types).toEqual([]);
    }
  });

  it('支持显式空数组作为零平台配置', () => {
    expect(parsePlatformConfig({ type: [] }).types).toEqual([]);
  });

  it('数组中混合 headless 别名和真实平台时忽略 headless 别名', () => {
    expect(parsePlatformConfig({ type: ['headless', 'web', 'telegram', 'web'] }).types)
      .toEqual(['web', 'telegram']);
  });

  it('IRIS_PLATFORM=headless 可临时覆盖为零平台', () => {
    process.env.IRIS_PLATFORM = 'headless';
    expect(parsePlatformConfig({ type: 'console' }).types).toEqual([]);
  });

  it('IRIS_PLATFORM 中混合别名和平台时只保留真实平台', () => {
    process.env.IRIS_PLATFORM = 'none,web,telegram,web';
    expect(parsePlatformConfig({ type: 'console' }).types).toEqual(['web', 'telegram']);
  });
});
