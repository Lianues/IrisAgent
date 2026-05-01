/** 通用调度任务服务 ID。由 cron extension 注册，业务 extension 通过该服务创建/管理任务。 */
export const SCHEDULER_SERVICE_ID = 'scheduler.tasks';

export type SchedulerScheduleConfig =
  | { type: 'cron'; expression: string }
  | { type: 'interval'; ms: number }
  | { type: 'once'; at: number };

export interface SchedulerDeliveryConfig {
  sessionId?: string;
  fallback?: 'last-active';
}

export interface SchedulerJob {
  id: string;
  name: string;
  schedule: SchedulerScheduleConfig;
  sessionId: string;
  instruction: string;
  delivery: SchedulerDeliveryConfig;
  silent: boolean;
  urgent: boolean;
  condition?: string;
  allowedTools?: string[];
  excludeTools?: string[];
  enabled: boolean;
  createdAt: number;
  createdInSession: string;
  lastRunAt?: number;
  lastRunStatus?: string;
  lastRunError?: string;
}

export interface SchedulerCreateJobInput {
  name: string;
  schedule: SchedulerScheduleConfig;
  instruction: string;
  sessionId?: string;
  delivery?: SchedulerDeliveryConfig;
  silent?: boolean;
  urgent?: boolean;
  condition?: string;
  allowedTools?: string[];
  excludeTools?: string[];
  createdInSession?: string;
}

export interface SchedulerUpdateJobInput {
  name?: string;
  schedule?: SchedulerScheduleConfig;
  instruction?: string;
  delivery?: SchedulerDeliveryConfig;
  silent?: boolean;
  urgent?: boolean;
  condition?: string;
  allowedTools?: string[];
  excludeTools?: string[];
}

export interface SchedulerJobFilter {
  enabled?: boolean;
  nameIncludes?: string;
}

export interface SchedulerService {
  createJob(input: SchedulerCreateJobInput): Promise<SchedulerJob> | SchedulerJob;
  updateJob(id: string, input: SchedulerUpdateJobInput): Promise<SchedulerJob | undefined> | SchedulerJob | undefined;
  deleteJob(id: string): Promise<boolean> | boolean;
  enableJob(id: string): Promise<SchedulerJob | undefined> | SchedulerJob | undefined;
  disableJob(id: string): Promise<SchedulerJob | undefined> | SchedulerJob | undefined;
  getJob(id: string): Promise<SchedulerJob | undefined> | SchedulerJob | undefined;
  listJobs(filter?: SchedulerJobFilter): Promise<SchedulerJob[]> | SchedulerJob[];
}
