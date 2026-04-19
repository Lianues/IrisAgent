import * as path from 'node:path';
import type { TerminalClassifierConfig, TerminalUseConfig } from './types.js';

export interface TerminalUseToolsConfig {
  getTerminalSnapshotAutoApprove: boolean;
  restartTerminalAutoApprove: boolean;
  execTerminalCommandClassifier: TerminalClassifierConfig;
  typeTerminalTextAutoApprove: boolean;
  pressTerminalKeyAutoApprove: boolean;
  scrollTerminalAutoApprove: boolean;
  waitTerminalAutoApprove: boolean;
  interruptTerminalAutoApprove: boolean;
}

export const DEFAULT_TERMINAL_USE_CONFIG: Omit<TerminalUseConfig, 'enabled' | 'cwd'> = {
  shell: undefined,
  cols: 120,
  rows: 32,
  scrollback: 5000,
  startupTimeoutMs: 10_000,
  defaultCommandTimeoutMs: 30_000,
  defaultWaitTimeoutMs: 10_000,
  idleQuietMs: 350,
  maxDisplayChars: 12_000,
  maxCommandOutputChars: 50_000,
  maxRecentSnapshots: 3,
};

export const DEFAULT_TERMINAL_USE_TOOLS_CONFIG: TerminalUseToolsConfig = {
  getTerminalSnapshotAutoApprove: true,
  restartTerminalAutoApprove: false,
  execTerminalCommandClassifier: {
    enabled: true,
    confidenceThreshold: 0.8,
    fallbackPolicy: 'deny',
    timeout: 8000,
  },
  typeTerminalTextAutoApprove: false,
  pressTerminalKeyAutoApprove: false,
  scrollTerminalAutoApprove: true,
  waitTerminalAutoApprove: true,
  interruptTerminalAutoApprove: false,
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseTerminalUseConfig(raw: unknown, projectRoot: string = process.cwd()): TerminalUseConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.enabled !== true) return undefined;

  const rawCwd = optionalString(record.cwd);
  const cwd = rawCwd
    ? (path.isAbsolute(rawCwd) ? rawCwd : path.resolve(projectRoot, rawCwd))
    : projectRoot;

  return {
    enabled: true,
    cwd,
    shell: optionalString(record.shell),
    cols: positiveNumber(record.cols, DEFAULT_TERMINAL_USE_CONFIG.cols),
    rows: positiveNumber(record.rows, DEFAULT_TERMINAL_USE_CONFIG.rows),
    scrollback: positiveNumber(record.scrollback, DEFAULT_TERMINAL_USE_CONFIG.scrollback),
    startupTimeoutMs: positiveNumber(record.startupTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs),
    defaultCommandTimeoutMs: positiveNumber(record.defaultCommandTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs),
    defaultWaitTimeoutMs: positiveNumber(record.defaultWaitTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs),
    idleQuietMs: positiveNumber(record.idleQuietMs, DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs),
    maxDisplayChars: positiveNumber(record.maxDisplayChars, DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars),
    maxCommandOutputChars: positiveNumber(record.maxCommandOutputChars, DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars),
    maxRecentSnapshots: Math.max(0, positiveNumber(record.maxRecentSnapshots, DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots)),
  };
}

export function parseTerminalUseToolsConfig(raw: unknown): TerminalUseToolsConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TERMINAL_USE_TOOLS_CONFIG };
  }

  const record = raw as Record<string, unknown>;
  const classifier = (record.execTerminalCommandClassifier && typeof record.execTerminalCommandClassifier === 'object' && !Array.isArray(record.execTerminalCommandClassifier))
    ? record.execTerminalCommandClassifier as Record<string, unknown>
    : {};

  const classifierConfig: TerminalClassifierConfig = {
    enabled: optionalBoolean(classifier.enabled, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.enabled),
  };
  const model = optionalString(classifier.model);
  if (model) classifierConfig.model = model;
  if (typeof classifier.confidenceThreshold === 'number' && classifier.confidenceThreshold > 0 && classifier.confidenceThreshold <= 1) {
    classifierConfig.confidenceThreshold = classifier.confidenceThreshold;
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold !== undefined) {
    classifierConfig.confidenceThreshold = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold;
  }
  if (classifier.fallbackPolicy === 'allow' || classifier.fallbackPolicy === 'deny') {
    classifierConfig.fallbackPolicy = classifier.fallbackPolicy;
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy) {
    classifierConfig.fallbackPolicy = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy;
  }
  if (typeof classifier.timeout === 'number' && classifier.timeout > 0) {
    classifierConfig.timeout = Math.floor(classifier.timeout);
  } else if (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout !== undefined) {
    classifierConfig.timeout = DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout;
  }

  return {
    getTerminalSnapshotAutoApprove: optionalBoolean(record.getTerminalSnapshotAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.getTerminalSnapshotAutoApprove),
    restartTerminalAutoApprove: optionalBoolean(record.restartTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.restartTerminalAutoApprove),
    execTerminalCommandClassifier: classifierConfig,
    typeTerminalTextAutoApprove: optionalBoolean(record.typeTerminalTextAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.typeTerminalTextAutoApprove),
    pressTerminalKeyAutoApprove: optionalBoolean(record.pressTerminalKeyAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.pressTerminalKeyAutoApprove),
    scrollTerminalAutoApprove: optionalBoolean(record.scrollTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.scrollTerminalAutoApprove),
    waitTerminalAutoApprove: optionalBoolean(record.waitTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.waitTerminalAutoApprove),
    interruptTerminalAutoApprove: optionalBoolean(record.interruptTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.interruptTerminalAutoApprove),
  };
}

export function toTerminalUseConfigContributionValues(config: TerminalUseConfig | undefined, projectRoot: string = process.cwd()): Record<string, unknown> {
  return {
    enabled: config?.enabled ?? false,
    cwd: config ? path.relative(projectRoot, config.cwd) || '.' : '.',
    shell: config?.shell ?? '',
    cols: config?.cols ?? DEFAULT_TERMINAL_USE_CONFIG.cols,
    rows: config?.rows ?? DEFAULT_TERMINAL_USE_CONFIG.rows,
    scrollback: config?.scrollback ?? DEFAULT_TERMINAL_USE_CONFIG.scrollback,
    startupTimeoutMs: config?.startupTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs,
    defaultCommandTimeoutMs: config?.defaultCommandTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs,
    defaultWaitTimeoutMs: config?.defaultWaitTimeoutMs ?? DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs,
    idleQuietMs: config?.idleQuietMs ?? DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs,
    maxDisplayChars: config?.maxDisplayChars ?? DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars,
    maxCommandOutputChars: config?.maxCommandOutputChars ?? DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars,
    maxRecentSnapshots: config?.maxRecentSnapshots ?? DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots,
  };
}

export function toTerminalUseToolsContributionValues(config: TerminalUseToolsConfig | undefined): Record<string, unknown> {
  const effective = config ?? DEFAULT_TERMINAL_USE_TOOLS_CONFIG;
  return {
    getTerminalSnapshotAutoApprove: effective.getTerminalSnapshotAutoApprove,
    restartTerminalAutoApprove: effective.restartTerminalAutoApprove,
    execClassifierEnabled: effective.execTerminalCommandClassifier.enabled,
    execClassifierModel: effective.execTerminalCommandClassifier.model ?? '',
    execConfidenceThreshold: effective.execTerminalCommandClassifier.confidenceThreshold ?? 0.8,
    execFallbackPolicy: effective.execTerminalCommandClassifier.fallbackPolicy ?? 'deny',
    execClassifierTimeout: effective.execTerminalCommandClassifier.timeout ?? 8000,
    typeTerminalTextAutoApprove: effective.typeTerminalTextAutoApprove,
    pressTerminalKeyAutoApprove: effective.pressTerminalKeyAutoApprove,
    scrollTerminalAutoApprove: effective.scrollTerminalAutoApprove,
    waitTerminalAutoApprove: effective.waitTerminalAutoApprove,
    interruptTerminalAutoApprove: effective.interruptTerminalAutoApprove,
  };
}

export function fromTerminalUseConfigContributionValues(values: Record<string, unknown>): Record<string, unknown> {
  const shell = optionalString(values.shell);
  const cwd = optionalString(values.cwd);
  return {
    enabled: values.enabled === true,
    ...(cwd ? { cwd } : {}),
    ...(shell ? { shell } : {}),
    cols: positiveNumber(values.cols, DEFAULT_TERMINAL_USE_CONFIG.cols),
    rows: positiveNumber(values.rows, DEFAULT_TERMINAL_USE_CONFIG.rows),
    scrollback: positiveNumber(values.scrollback, DEFAULT_TERMINAL_USE_CONFIG.scrollback),
    startupTimeoutMs: positiveNumber(values.startupTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.startupTimeoutMs),
    defaultCommandTimeoutMs: positiveNumber(values.defaultCommandTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultCommandTimeoutMs),
    defaultWaitTimeoutMs: positiveNumber(values.defaultWaitTimeoutMs, DEFAULT_TERMINAL_USE_CONFIG.defaultWaitTimeoutMs),
    idleQuietMs: positiveNumber(values.idleQuietMs, DEFAULT_TERMINAL_USE_CONFIG.idleQuietMs),
    maxDisplayChars: positiveNumber(values.maxDisplayChars, DEFAULT_TERMINAL_USE_CONFIG.maxDisplayChars),
    maxCommandOutputChars: positiveNumber(values.maxCommandOutputChars, DEFAULT_TERMINAL_USE_CONFIG.maxCommandOutputChars),
    maxRecentSnapshots: Math.max(0, positiveNumber(values.maxRecentSnapshots, DEFAULT_TERMINAL_USE_CONFIG.maxRecentSnapshots)),
  };
}

export function fromTerminalUseToolsContributionValues(values: Record<string, unknown>): Record<string, unknown> {
  const model = optionalString(values.execClassifierModel);
  return {
    getTerminalSnapshotAutoApprove: optionalBoolean(values.getTerminalSnapshotAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.getTerminalSnapshotAutoApprove),
    restartTerminalAutoApprove: optionalBoolean(values.restartTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.restartTerminalAutoApprove),
    execTerminalCommandClassifier: {
      enabled: optionalBoolean(values.execClassifierEnabled, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.enabled),
      ...(model ? { model } : {}),
      confidenceThreshold: typeof values.execConfidenceThreshold === 'number' && values.execConfidenceThreshold > 0 && values.execConfidenceThreshold <= 1
        ? values.execConfidenceThreshold
        : (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.confidenceThreshold ?? 0.8),
      fallbackPolicy: values.execFallbackPolicy === 'allow' || values.execFallbackPolicy === 'deny'
        ? values.execFallbackPolicy
        : (DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.fallbackPolicy ?? 'deny'),
      timeout: positiveNumber(values.execClassifierTimeout, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.execTerminalCommandClassifier.timeout ?? 8000),
    },
    typeTerminalTextAutoApprove: optionalBoolean(values.typeTerminalTextAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.typeTerminalTextAutoApprove),
    pressTerminalKeyAutoApprove: optionalBoolean(values.pressTerminalKeyAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.pressTerminalKeyAutoApprove),
    scrollTerminalAutoApprove: optionalBoolean(values.scrollTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.scrollTerminalAutoApprove),
    waitTerminalAutoApprove: optionalBoolean(values.waitTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.waitTerminalAutoApprove),
    interruptTerminalAutoApprove: optionalBoolean(values.interruptTerminalAutoApprove, DEFAULT_TERMINAL_USE_TOOLS_CONFIG.interruptTerminalAutoApprove),
  };
}
