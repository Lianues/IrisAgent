/**
 * Web 多 Agent 生命周期适配测试
 *
 * 覆盖 WebPlatform 对 Host 多 Agent 运行时的轻量适配：
 * - 构造时使用真实默认 Agent 名称，而不是在多 Agent 模式下丢失 master
 * - reloadAgents 不再依赖已移除的 enabled 开关
 * - 新增/删除 Agent 时通过 reloadHandler 同步 Host 生命周期
 */

import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { WebPlatform, type WebPlatformConfig } from '../extensions/web/src/web-platform';

function createBackend() {
  const backend = new EventEmitter() as any;
  backend.chat = vi.fn(async () => undefined);
  backend.isStreamEnabled = vi.fn(() => true);
  backend.clearSession = vi.fn(async () => undefined);
  backend.switchModel = vi.fn(() => ({ modelName: 'mock', modelId: 'mock-model' }));
  backend.listModels = vi.fn(() => []);
  backend.listSessionMetas = vi.fn(async () => []);
  backend.abortChat = vi.fn();
  backend.getToolHandle = vi.fn(() => undefined);
  backend.getToolHandles = vi.fn(() => []);
  backend.getCurrentModelInfo = vi.fn(() => ({ provider: 'mock-provider', modelId: 'mock-model', modelName: 'mock' }));
  return backend;
}

const baseConfig: WebPlatformConfig = {
  port: 8192,
  host: '127.0.0.1',
  configPath: 'C:/tmp/iris/agents/master/configs',
  provider: 'mock-provider',
  modelId: 'mock-model',
  streamEnabled: true,
};

function createCoreLike(name: string, backend = createBackend()) {
  return {
    backend,
    backendHandle: backend,
    router: {
      getCurrentModelInfo: () => ({ provider: 'mock-provider', modelId: `${name}-model`, modelName: `${name}-model` }),
    },
    config: { system: { stream: true } },
    configDir: `C:/tmp/iris/agents/${name}/configs`,
    extensions: { llmProviders: {}, ocrProviders: {} },
    irisAPI: {},
  };
}

describe('WebPlatform 多 Agent 生命周期适配', () => {
  it('多 Agent 启动时保留真实默认 Agent，并追加其他 Agent', () => {
    const masterBackend = createBackend();
    const workerBackend = createBackend();
    const platform = new WebPlatform(masterBackend, baseConfig, { agentName: 'master' });

    platform.addAgent('worker', workerBackend, baseConfig, '工作 Agent');

    expect(platform.getAgentList()).toEqual([
      { name: 'master', description: undefined },
      { name: 'worker', description: '工作 Agent' },
    ]);
  });

  it('reloadAgents 根据 agents.yaml 差异新增和销毁 Agent', async () => {
    const masterBackend = createBackend();
    const oldBackend = createBackend();
    const newBackend = createBackend();
    const agentManager = {
      resetCache: vi.fn(),
      getStatus: vi.fn(() => ({
        manifestPath: 'C:/tmp/iris/agents.yaml',
        agents: [
          { name: 'master', description: '主助手' },
          { name: 'new-agent', description: '新助手' },
        ],
      })),
    };

    const platform = new WebPlatform(masterBackend, baseConfig, { agentName: 'master', api: { agentManager } as any });
    platform.addAgent('old-agent', oldBackend, baseConfig, '旧助手');

    const reloadHandler = vi.fn(async (request: any) => {
      if (request?.action === 'destroy') {
        return { destroyed: true, name: request.name };
      }
      return createCoreLike(request.name, newBackend);
    });
    platform.setReloadHandler(reloadHandler as any);

    const result = await platform.reloadAgents();

    expect(agentManager.resetCache).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      added: ['new-agent'],
      removed: ['old-agent'],
      kept: ['master'],
    });
    expect(reloadHandler).toHaveBeenCalledWith({ action: 'destroy', name: 'old-agent' });
    expect(reloadHandler).toHaveBeenCalledWith({ name: 'new-agent', description: '新助手' });
    expect(platform.getAgentList().map(agent => agent.name)).toEqual(['master', 'new-agent']);
  });

  it('从单 Agent 扩展为多 Agent 时刷新保留 Agent 以获得 agentNetwork 能力', async () => {
    const masterBackend = createBackend();
    const workerBackend = createBackend();
    const refreshedMasterBackend = createBackend();
    const agentManager = {
      resetCache: vi.fn(),
      getStatus: vi.fn(() => ({
        manifestPath: 'C:/tmp/iris/agents.yaml',
        agents: [
          { name: 'master', description: '主助手' },
          { name: 'worker', description: '工作助手' },
        ],
      })),
    };

    const platform = new WebPlatform(masterBackend, baseConfig, { agentName: 'master', api: { agentManager } as any });
    const reloadHandler = vi.fn(async (request: any) => {
      if (request.name === 'worker') return createCoreLike('worker', workerBackend);
      if (request.name === 'master') return createCoreLike('master', refreshedMasterBackend);
      throw new Error(`unexpected request: ${JSON.stringify(request)}`);
    });
    platform.setReloadHandler(reloadHandler as any);

    const result = await platform.reloadAgents();

    expect(result).toMatchObject({ added: ['worker'], removed: [], kept: ['master'] });
    // 先 spawn 新 Agent，再 reload 保留的 master，使 master 的 delegate 工具描述能看到新 peer。
    expect(reloadHandler.mock.calls.map(call => call[0]?.name)).toEqual(['worker', 'master']);
    expect(platform.getAgentList().map(agent => agent.name)).toEqual(['master', 'worker']);
  });

  it('agents.yaml 解析为空时保留当前运行状态，避免误销毁所有 Agent', async () => {
    const masterBackend = createBackend();
    const workerBackend = createBackend();
    const agentManager = {
      resetCache: vi.fn(),
      getStatus: vi.fn(() => ({
        manifestPath: 'C:/tmp/iris/agents.yaml',
        agents: [],
      })),
    };

    const platform = new WebPlatform(masterBackend, baseConfig, { agentName: 'master', api: { agentManager } as any });
    platform.addAgent('worker', workerBackend, baseConfig, '工作 Agent');

    const reloadHandler = vi.fn(async () => createCoreLike('unused'));
    platform.setReloadHandler(reloadHandler as any);

    const result = await platform.reloadAgents();

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(['master', 'worker']);
    expect(reloadHandler).not.toHaveBeenCalled();
    expect(platform.getAgentList().map(agent => agent.name)).toEqual(['master', 'worker']);
  });
});
