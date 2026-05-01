import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULER_SERVICE_ID } from 'irises-extension-sdk';
import { CronScheduler } from '../extensions/cron/src/scheduler.js';
import { createCronSchedulerService } from '../extensions/cron/src/service.js';

function createApi(activeSessionId = 'active-session') {
  return {
    agentManager: { getActiveSessionId: () => activeSessionId },
    globalStore: {
      agent: () => ({ getAll: () => ({}) }),
      session: () => ({ getAll: () => ({}) }),
      keys: () => [],
      get: () => undefined,
    },
    tools: {},
    router: {},
  } as any;
}

describe('scheduler.tasks service', () => {
  it('cron extension 可通过通用 SchedulerService 创建/查询/删除任务', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-scheduler-service-'));
    try {
      const api = createApi();
      const scheduler = new CronScheduler(api, undefined, null, 'master', undefined, tmpDir);
      const service = createCronSchedulerService(scheduler, api);

      const job = await service.createJob({
        name: 'test job',
        schedule: { type: 'once', at: Date.now() + 60_000 },
        instruction: 'do something',
        silent: true,
        allowedTools: ['virtual_lover_proactive_send'],
      });

      expect(SCHEDULER_SERVICE_ID).toBe('scheduler.tasks');
      expect(job).toMatchObject({
        name: 'test job',
        sessionId: 'active-session',
        silent: true,
        allowedTools: ['virtual_lover_proactive_send'],
      });
      expect(await service.getJob(job.id)).toMatchObject({ id: job.id });
      expect(await service.listJobs({ enabled: true })).toHaveLength(1);
      expect(await service.deleteJob(job.id)).toBe(true);
      expect(await service.listJobs()).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
