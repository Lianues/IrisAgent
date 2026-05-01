import type {
  IrisAPI,
  SchedulerCreateJobInput,
  SchedulerJob,
  SchedulerJobFilter,
  SchedulerService,
  SchedulerUpdateJobInput,
} from 'irises-extension-sdk';
import type { CronScheduler } from './scheduler.js';
import type { ScheduledJob } from './types.js';

function toSchedulerJob(job: ScheduledJob): SchedulerJob {
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    sessionId: job.sessionId,
    instruction: job.instruction,
    delivery: job.delivery,
    silent: job.silent,
    urgent: job.urgent,
    condition: job.condition,
    allowedTools: job.allowedTools,
    excludeTools: job.excludeTools,
    enabled: job.enabled,
    createdAt: job.createdAt,
    createdInSession: job.createdInSession,
    lastRunAt: job.lastRunAt,
    lastRunStatus: job.lastRunStatus,
    lastRunError: job.lastRunError,
  };
}

function resolveSessionId(api: IrisAPI, input: SchedulerCreateJobInput): string {
  return input.sessionId
    ?? input.delivery?.sessionId
    ?? api.agentManager?.getActiveSessionId?.()
    ?? 'scheduler-service';
}

function applyFilter(jobs: SchedulerJob[], filter?: SchedulerJobFilter): SchedulerJob[] {
  if (!filter) return jobs;
  return jobs.filter((job) => {
    if (filter.enabled !== undefined && job.enabled !== filter.enabled) return false;
    if (filter.nameIncludes && !job.name.includes(filter.nameIncludes)) return false;
    return true;
  });
}

export function createCronSchedulerService(scheduler: CronScheduler, api: IrisAPI): SchedulerService {
  return {
    createJob(input) {
      const sessionId = resolveSessionId(api, input);
      const job = scheduler.createJob({
        name: input.name,
        schedule: input.schedule,
        sessionId,
        instruction: input.instruction,
        delivery: {
          fallback: input.delivery?.fallback ?? 'last-active',
          sessionId: input.delivery?.sessionId ?? sessionId,
        },
        silent: input.silent,
        urgent: input.urgent,
        condition: input.condition,
        allowedTools: input.allowedTools,
        excludeTools: input.excludeTools,
        createdInSession: input.createdInSession ?? sessionId,
      });
      return toSchedulerJob(job);
    },

    updateJob(id, input: SchedulerUpdateJobInput) {
      const job = scheduler.updateJob(id, input as any);
      return job ? toSchedulerJob(job) : undefined;
    },

    deleteJob(id) {
      return scheduler.deleteJob(id);
    },

    enableJob(id) {
      const job = scheduler.enableJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },

    disableJob(id) {
      const job = scheduler.disableJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },

    getJob(id) {
      const job = scheduler.getJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },

    listJobs(filter) {
      return applyFilter(scheduler.listJobs().map(toSchedulerJob), filter);
    },
  };
}
