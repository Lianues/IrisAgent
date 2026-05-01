import type { DeliveryBinding, DeliveryPolicy, DeliveryTarget, DeliveryTargetKind } from 'irises-extension-sdk';

export interface DeliveryConfig {
  bindings: DeliveryBinding[];
  policies: DeliveryPolicy[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown): number | undefined {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizeTargetKind(value: unknown, fallback: DeliveryTargetKind): DeliveryTargetKind {
  return value === 'chat' || value === 'user' || value === 'room' || value === 'channel' ? value : fallback;
}

function parseTarget(raw: unknown): DeliveryTarget | undefined {
  if (!isRecord(raw)) return undefined;
  const id = readString(raw.id).trim();
  if (!id) return undefined;
  return {
    kind: normalizeTargetKind(raw.kind, 'chat'),
    id,
    accountId: readString(raw.accountId).trim() || undefined,
    threadId: readString(raw.threadId).trim() || undefined,
    raw: raw.raw,
  };
}

export function parseDeliveryConfig(raw: unknown): DeliveryConfig {
  if (!isRecord(raw)) return { bindings: [], policies: [] };
  const rawBindings = isRecord(raw.bindings) ? raw.bindings : {};
  const rawPolicies = isRecord(raw.policies) ? raw.policies : {};
  const bindings: DeliveryBinding[] = [];
  const policies: DeliveryPolicy[] = [];

  for (const [id, value] of Object.entries(rawBindings)) {
    if (!isRecord(value)) continue;
    const normalizedId = id.trim();
    const platform = readString(value.platform).trim().toLowerCase();
    const target = parseTarget(value.target);
    if (!normalizedId || !platform || !target) continue;
    bindings.push({
      id: normalizedId,
      label: readString(value.label).trim() || undefined,
      platform,
      target,
      defaultSessionId: readString(value.defaultSessionId).trim() || undefined,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
      policyId: readString(value.policyId || value.policy).trim() || undefined,
    });
  }

  for (const [id, value] of Object.entries(rawPolicies)) {
    if (!isRecord(value)) continue;
    const normalizedId = id.trim();
    if (!normalizedId) continue;
    const quietHours = isRecord(value.quietHours) ? value.quietHours : undefined;
    const skipRecent = isRecord(value.skipIfRecentActivity) ? value.skipIfRecentActivity : undefined;
    policies.push({
      id: normalizedId,
      label: readString(value.label).trim() || undefined,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      cooldownMinutes: readNumber(value.cooldownMinutes),
      maxPerDay: readNumber(value.maxPerDay),
      quietHours: quietHours ? {
        enabled: typeof quietHours.enabled === 'boolean' ? quietHours.enabled : true,
        windows: Array.isArray(quietHours.windows)
          ? quietHours.windows.filter(isRecord).map((window) => ({
            start: readString(window.start, '23:00'),
            end: readString(window.end, '07:00'),
          }))
          : [],
        allowUrgent: typeof quietHours.allowUrgent === 'boolean' ? quietHours.allowUrgent : false,
      } : undefined,
      skipIfRecentActivity: skipRecent ? {
        enabled: typeof skipRecent.enabled === 'boolean' ? skipRecent.enabled : true,
        withinMinutes: readNumber(skipRecent.withinMinutes) ?? 10,
      } : undefined,
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
    });
  }

  return { bindings, policies };
}
