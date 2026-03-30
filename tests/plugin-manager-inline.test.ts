/**
 * 插件系统：内联插件测试。
 */

import { describe, expect, it } from 'vitest';
import { PluginManager } from '../src/extension/manager.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ModeRegistry } from '../src/modes/registry.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { IrisPlugin } from '@irises/extension-sdk';

function createInternals() {
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test');
  return {
    tools: new ToolRegistry(),
    modes: new ModeRegistry(),
    prompt,
    router: {} as any,
  };
}

describe('PluginManager: inline plugins', () => {
  it('支持内联插件的 prepare / activate / ready / platformsReady 流程', async () => {
    const calls: string[] = [];
    let seenConfig: Record<string, unknown> | undefined;

    const plugin: IrisPlugin = {
      name: 'inline-demo',
      version: '1.0.0',
      activate(ctx) {
        calls.push('activate');
        seenConfig = ctx.getPluginConfig();
        ctx.onReady(() => {
          calls.push('ready');
        });
        ctx.onPlatformsReady(() => {
          calls.push('platforms');
        });
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [{
      plugin,
      priority: 10,
      config: { apiKey: 'demo-key' },
    }]);

    await manager.activateAll(createInternals(), {} as any);
    expect(manager.listPlugins()).toHaveLength(1);
    expect(manager.listPlugins()[0].type).toBe('inline');
    expect(seenConfig).toEqual({ apiKey: 'demo-key' });

    await manager.notifyReady({} as any);
    await manager.notifyPlatformsReady(new Map());

    expect(calls).toEqual(['activate', 'ready', 'platforms']);
  });

  it('按 priority 从高到低激活内联插件', async () => {
    const order: string[] = [];

    const low: IrisPlugin = {
      name: 'inline-low',
      version: '1.0.0',
      activate() {
        order.push('low');
      },
    };

    const high: IrisPlugin = {
      name: 'inline-high',
      version: '1.0.0',
      activate() {
        order.push('high');
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [
      { plugin: low, priority: 1 },
      { plugin: high, priority: 100 },
    ]);

    await manager.activateAll(createInternals(), {} as any);
    expect(order).toEqual(['high', 'low']);
  });
});
