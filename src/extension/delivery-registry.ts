import type {
  DeliveryActivityInput,
  DeliveryAttachmentInput,
  DeliveryBinding,
  DeliveryBindingAttachmentInput,
  DeliveryBindingTextInput,
  DeliveryPolicy,
  DeliveryPolicyDecision,
  DeliveryPolicyEvaluateInput,
  DeliveryProviderInfo,
  DeliveryRegistryService,
  DeliveryRecentTarget,
  DeliveryRecentTargetFilter,
  DeliveryResult,
  DeliverySendRecord,
  DeliverySendRecordFilter,
  DeliveryTarget,
  DeliveryTextInput,
  Disposable,
  PlatformDeliveryProvider,
} from 'irises-extension-sdk';
import { createLogger } from '../logger';

const logger = createLogger('DeliveryRegistry');

interface ProviderEntry {
  provider: PlatformDeliveryProvider;
  token: symbol;
}

interface BindingEntry { binding: DeliveryBinding; token: symbol }
interface PolicyEntry { policy: DeliveryPolicy; token: symbol }
interface ActivityRecord { platform: string; target: DeliveryTarget; label?: string; occurredAt: number; metadata?: Record<string, unknown> }

/**
 * 通用主动投递注册中心。
 *
 * 只负责 provider/binding/policy 注册和路由，不包含任何平台私有逻辑。
 */
export class DeliveryRegistry implements DeliveryRegistryService {
  private providers = new Map<string, ProviderEntry>();
  private bindings = new Map<string, BindingEntry>();
  private policies = new Map<string, PolicyEntry>();
  private sendRecords: DeliverySendRecord[] = [];
  private activityRecords = new Map<string, ActivityRecord>();
  private sendRecordSeq = 0;

  registerProvider(provider: PlatformDeliveryProvider): Disposable {
    const platform = normalizePlatform(provider.platform);
    if (!platform) throw new Error('delivery provider 缺少有效 platform');
    if (!provider.capabilities?.text || typeof provider.sendText !== 'function') {
      throw new Error(`delivery provider "${platform}" 必须提供 text 能力和 sendText()`);
    }

    const token = Symbol(platform);
    if (this.providers.has(platform)) {
      logger.warn(`delivery provider "${platform}" 已存在，将被覆盖`);
    }

    this.providers.set(platform, { provider: { ...provider, platform }, token });
    logger.info(`delivery provider 已注册: ${platform}`);

    return {
      dispose: () => {
        const current = this.providers.get(platform);
        if (current?.token === token) {
          this.providers.delete(platform);
          logger.info(`delivery provider 已注销: ${platform}`);
        }
      },
    };
  }

  getProvider(platform: string): PlatformDeliveryProvider | undefined {
    return this.providers.get(normalizePlatform(platform))?.provider;
  }

  listProviders(): DeliveryProviderInfo[] {
    return Array.from(this.providers.values())
      .map(({ provider }) => ({
        platform: provider.platform,
        capabilities: { ...provider.capabilities },
      }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }

  registerBinding(binding: DeliveryBinding): Disposable {
    const normalized = normalizeBinding(binding);
    const token = Symbol(normalized.id);
    if (this.bindings.has(normalized.id)) {
      logger.warn(`delivery binding "${normalized.id}" 已存在，将被覆盖`);
    }
    this.bindings.set(normalized.id, { binding: normalized, token });
    logger.info(`delivery binding 已注册: ${normalized.id} -> ${normalized.platform}`);
    return {
      dispose: () => {
        const current = this.bindings.get(normalized.id);
        if (current?.token === token) {
          this.bindings.delete(normalized.id);
          logger.info(`delivery binding 已注销: ${normalized.id}`);
        }
      },
    };
  }

  replaceBindings(bindings: DeliveryBinding[]): void {
    this.bindings.clear();
    for (const binding of bindings) this.registerBinding(binding);
  }

  getBinding(id: string): DeliveryBinding | undefined {
    const binding = this.bindings.get(normalizeBindingId(id))?.binding;
    return binding ? cloneBinding(binding) : undefined;
  }

  listBindings(): DeliveryBinding[] {
    return Array.from(this.bindings.values())
      .map(({ binding }) => cloneBinding(binding))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  registerPolicy(policy: DeliveryPolicy): Disposable {
    const normalized = normalizePolicy(policy);
    const token = Symbol(normalized.id);
    if (this.policies.has(normalized.id)) {
      logger.warn(`delivery policy "${normalized.id}" 已存在，将被覆盖`);
    }
    this.policies.set(normalized.id, { policy: normalized, token });
    logger.info(`delivery policy 已注册: ${normalized.id}`);
    return {
      dispose: () => {
        const current = this.policies.get(normalized.id);
        if (current?.token === token) {
          this.policies.delete(normalized.id);
          logger.info(`delivery policy 已注销: ${normalized.id}`);
        }
      },
    };
  }

  replacePolicies(policies: DeliveryPolicy[]): void {
    this.policies.clear();
    for (const policy of policies) this.registerPolicy(policy);
  }

  getPolicy(id: string): DeliveryPolicy | undefined {
    const policy = this.policies.get(normalizePolicyId(id))?.policy;
    return policy ? clonePolicy(policy) : undefined;
  }

  listPolicies(): DeliveryPolicy[] {
    return Array.from(this.policies.values())
      .map(({ policy }) => clonePolicy(policy))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  evaluatePolicy(input: DeliveryPolicyEvaluateInput): DeliveryPolicyDecision {
    const policyId = normalizePolicyId(input.policyId ?? '');
    if (!policyId) return { allowed: true, skipped: false };

    const policy = this.policies.get(policyId)?.policy;
    if (!policy) return { allowed: false, skipped: true, policyId, reason: `delivery policy 不存在: ${policyId}` };
    if (policy.enabled === false) return { allowed: false, skipped: true, policyId, reason: `delivery policy 已禁用: ${policyId}` };

    const now = input.now ?? Date.now();
    const urgent = input.urgent === true;

    if (policy.quietHours?.enabled && !(urgent && policy.quietHours.allowUrgent)) {
      for (const window of policy.quietHours.windows ?? []) {
        if (isInQuietHours(new Date(now), window.start, window.end)) {
          return { allowed: false, skipped: true, policyId, reason: `当前处于 delivery policy 安静时段: ${window.start}-${window.end}` };
        }
      }
    }

    const scopeKey = makePolicyScopeKey(policyId, input.binding, input.platform, input.target);
    const successRecords = this.sendRecords
      .filter((record) => record.ok && makePolicyScopeKey(record.policyId, record.binding, record.platform, record.target) === scopeKey)
      .sort((a, b) => b.sentAt - a.sentAt);

    const cooldownMinutes = policy.cooldownMinutes ?? 0;
    if (cooldownMinutes > 0 && successRecords.length > 0) {
      const nextAllowedAt = successRecords[0].sentAt + cooldownMinutes * 60_000;
      if (now < nextAllowedAt) {
        return { allowed: false, skipped: true, policyId, nextAllowedAt, reason: `delivery policy 冷却中，${new Date(nextAllowedAt).toLocaleString()} 后可再次发送` };
      }
    }

    const maxPerDay = policy.maxPerDay ?? 0;
    if (maxPerDay > 0) {
      const dayStart = startOfLocalDay(now);
      const sentToday = successRecords.filter((record) => record.sentAt >= dayStart && record.sentAt <= now).length;
      if (sentToday >= maxPerDay) {
        return { allowed: false, skipped: true, policyId, reason: `delivery policy 今日发送次数已达上限 (${maxPerDay})` };
      }
    }

    if (policy.skipIfRecentActivity?.enabled && input.platform && input.target) {
      const activity = this.activityRecords.get(makeTargetKey(input.platform, input.target));
      const withinMs = Math.max(0, policy.skipIfRecentActivity.withinMinutes) * 60_000;
      if (activity && now - activity.occurredAt < withinMs) {
        return { allowed: false, skipped: true, policyId, reason: `目标 ${input.platform}:${input.target.id} 最近有活动，跳过主动投递` };
      }
    }

    return { allowed: true, skipped: false, policyId };
  }

  recordActivity(input: DeliveryActivityInput): void {
    const platform = normalizePlatform(input.platform);
    if (!platform || !input.target?.id) return;
    this.activityRecords.set(makeTargetKey(platform, input.target), {
      platform,
      target: { ...input.target },
      label: input.label,
      occurredAt: input.occurredAt ?? Date.now(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    });
  }

  listRecentTargets(filter: DeliveryRecentTargetFilter = {}): DeliveryRecentTarget[] {
    const platform = filter.platform ? normalizePlatform(filter.platform) : undefined;
    return Array.from(this.activityRecords.values())
      .filter((record) => !platform || record.platform === platform)
      .map((record) => ({
        platform: record.platform,
        target: { ...record.target },
        label: record.label,
        lastActivityAt: record.occurredAt,
        metadata: record.metadata ? { ...record.metadata } : undefined,
      }))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  listSendRecords(filter: DeliverySendRecordFilter = {}): DeliverySendRecord[] {
    return this.sendRecords
      .filter((record) => {
        if (filter.policyId && record.policyId !== filter.policyId) return false;
        if (filter.binding && record.binding !== filter.binding) return false;
        if (filter.platform && record.platform !== normalizePlatform(filter.platform)) return false;
        if (filter.since && record.sentAt < filter.since) return false;
        return true;
      })
      .map(cloneSendRecord)
      .sort((a, b) => b.sentAt - a.sentAt);
  }

  async sendText(input: DeliveryTextInput): Promise<DeliveryResult> {
    const platform = normalizePlatform(input.platform);
    const provider = this.getProvider(platform);
    if (!provider) return { ok: false, platform, error: `未注册 delivery provider: ${platform}` };
    if (!input.text.trim()) return { ok: false, platform, error: '投递文本不能为空' };

    const decision = this.evaluatePolicy({
      policyId: input.policyId,
      platform,
      target: input.target,
      urgent: input.urgent,
      metadata: input.metadata,
    });
    if (decision.skipped) return policySkippedResult(platform, decision);

    try {
      const result = normalizeResult(platform, await provider.sendText({
        target: input.target,
        text: input.text,
        sessionId: input.sessionId,
        metadata: input.metadata,
      }));
      this.recordSend({ policyId: input.policyId, platform, target: input.target, result, metadata: input.metadata });
      return result;
    } catch (error) {
      const result = { ok: false, platform, error: error instanceof Error ? error.message : String(error) };
      this.recordSend({ policyId: input.policyId, platform, target: input.target, result, metadata: input.metadata });
      return result;
    }
  }

  async sendAttachment(input: DeliveryAttachmentInput): Promise<DeliveryResult> {
    const platform = normalizePlatform(input.platform);
    const provider = this.getProvider(platform);
    if (!provider) return { ok: false, platform, error: `未注册 delivery provider: ${platform}` };
    if (!provider.sendAttachment) return { ok: false, platform, error: `delivery provider "${platform}" 不支持附件投递` };

    const decision = this.evaluatePolicy({
      policyId: input.policyId,
      platform,
      target: input.target,
      urgent: input.urgent,
      metadata: input.metadata,
    });
    if (decision.skipped) return policySkippedResult(platform, decision);

    try {
      const result = normalizeResult(platform, await provider.sendAttachment({
        target: input.target,
        attachment: input.attachment,
        caption: input.caption,
        sessionId: input.sessionId,
        metadata: input.metadata,
      }));
      this.recordSend({ policyId: input.policyId, platform, target: input.target, result, metadata: input.metadata });
      return result;
    } catch (error) {
      const result = { ok: false, platform, error: error instanceof Error ? error.message : String(error) };
      this.recordSend({ policyId: input.policyId, platform, target: input.target, result, metadata: input.metadata });
      return result;
    }
  }

  async sendTextToBinding(input: DeliveryBindingTextInput): Promise<DeliveryResult> {
    const binding = this.bindings.get(normalizeBindingId(input.binding))?.binding;
    if (!binding) return { ok: false, platform: '', error: `未注册 delivery binding: ${input.binding}` };
    if (binding.enabled === false) return { ok: false, platform: binding.platform, error: `delivery binding 已禁用: ${binding.id}` };

    const policyId = input.policyId ?? binding.policyId;
    const metadata = { ...(binding.metadata ?? {}), ...(input.metadata ?? {}), binding: binding.id };
    const decision = this.evaluatePolicy({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, urgent: input.urgent, metadata });
    if (decision.skipped) return policySkippedResult(binding.platform, decision);

    const provider = this.getProvider(binding.platform);
    if (!provider) return { ok: false, platform: binding.platform, error: `未注册 delivery provider: ${binding.platform}` };
    if (!input.text.trim()) return { ok: false, platform: binding.platform, error: '投递文本不能为空' };

    try {
      const result = normalizeResult(binding.platform, await provider.sendText({
        target: binding.target,
        text: input.text,
        sessionId: input.sessionId ?? binding.defaultSessionId,
        metadata,
      }));
      this.recordSend({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, result, metadata });
      return result;
    } catch (error) {
      const result = { ok: false, platform: binding.platform, error: error instanceof Error ? error.message : String(error) };
      this.recordSend({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, result, metadata });
      return result;
    }
  }

  async sendAttachmentToBinding(input: DeliveryBindingAttachmentInput): Promise<DeliveryResult> {
    const binding = this.bindings.get(normalizeBindingId(input.binding))?.binding;
    if (!binding) return { ok: false, platform: '', error: `未注册 delivery binding: ${input.binding}` };
    if (binding.enabled === false) return { ok: false, platform: binding.platform, error: `delivery binding 已禁用: ${binding.id}` };

    const provider = this.getProvider(binding.platform);
    if (!provider) return { ok: false, platform: binding.platform, error: `未注册 delivery provider: ${binding.platform}` };
    if (!provider.sendAttachment) return { ok: false, platform: binding.platform, error: `delivery provider "${binding.platform}" 不支持附件投递` };

    const policyId = input.policyId ?? binding.policyId;
    const metadata = { ...(binding.metadata ?? {}), ...(input.metadata ?? {}), binding: binding.id };
    const decision = this.evaluatePolicy({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, urgent: input.urgent, metadata });
    if (decision.skipped) return policySkippedResult(binding.platform, decision);

    try {
      const result = normalizeResult(binding.platform, await provider.sendAttachment({
        target: binding.target,
        attachment: input.attachment,
        caption: input.caption,
        sessionId: input.sessionId ?? binding.defaultSessionId,
        metadata,
      }));
      this.recordSend({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, result, metadata });
      return result;
    } catch (error) {
      const result = { ok: false, platform: binding.platform, error: error instanceof Error ? error.message : String(error) };
      this.recordSend({ policyId, binding: binding.id, platform: binding.platform, target: binding.target, result, metadata });
      return result;
    }
  }

  private recordSend(input: { policyId?: string; binding?: string; platform: string; target: DeliveryTarget; result: DeliveryResult; metadata?: Record<string, unknown> }): void {
    this.sendRecords.push({
      id: `delivery_send_${++this.sendRecordSeq}_${Date.now()}`,
      policyId: input.policyId,
      binding: input.binding,
      platform: normalizePlatform(input.platform),
      target: { ...input.target },
      sentAt: Date.now(),
      ok: input.result.ok,
      messageId: input.result.messageId,
      error: input.result.error,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    });
    if (this.sendRecords.length > 1000) this.sendRecords.splice(0, this.sendRecords.length - 1000);
  }
}

function normalizePlatform(platform: string): string {
  return String(platform ?? '').trim().toLowerCase();
}

function normalizeBindingId(id: string): string {
  return String(id ?? '').trim();
}

function normalizePolicyId(id: string): string {
  return String(id ?? '').trim();
}

function normalizeBinding(binding: DeliveryBinding): DeliveryBinding {
  const id = normalizeBindingId(binding.id);
  const platform = normalizePlatform(binding.platform);
  if (!id) throw new Error('delivery binding 缺少有效 id');
  if (!platform) throw new Error(`delivery binding "${id}" 缺少有效 platform`);
  if (!binding.target?.id?.trim()) throw new Error(`delivery binding "${id}" 缺少有效 target.id`);
  return { ...cloneBinding(binding), id, platform, enabled: binding.enabled !== false };
}

function normalizePolicy(policy: DeliveryPolicy): DeliveryPolicy {
  const id = normalizePolicyId(policy.id);
  if (!id) throw new Error('delivery policy 缺少有效 id');
  return { ...clonePolicy(policy), id, enabled: policy.enabled !== false };
}

function cloneBinding(binding: DeliveryBinding): DeliveryBinding {
  return { ...binding, target: { ...binding.target }, metadata: binding.metadata ? { ...binding.metadata } : undefined };
}

function clonePolicy(policy: DeliveryPolicy): DeliveryPolicy {
  return { ...policy, metadata: policy.metadata ? { ...policy.metadata } : undefined };
}

function cloneSendRecord(record: DeliverySendRecord): DeliverySendRecord {
  return { ...record, target: { ...record.target }, metadata: record.metadata ? { ...record.metadata } : undefined };
}

function normalizeResult(platform: string, result: DeliveryResult): DeliveryResult {
  return { ...result, platform: normalizePlatform(result.platform || platform) || platform };
}

function policySkippedResult(platform: string, decision: DeliveryPolicyDecision): DeliveryResult {
  return { ok: false, platform, skipped: true, error: decision.reason ?? 'delivery policy skipped', raw: { policyDecision: decision } };
}

function makeTargetKey(platform: string, target: DeliveryTarget): string {
  const normalizedPlatform = normalizePlatform(platform);
  return [normalizedPlatform, normalizedPlatform === 'telegram' ? 'chat' : target.kind, target.id, target.threadId ?? ''].join('|');
}

function makePolicyScopeKey(policyId?: string, binding?: string, platform?: string, target?: DeliveryTarget): string {
  if (binding) return `${policyId ?? ''}|binding:${binding}`;
  if (platform && target) return `${policyId ?? ''}|target:${makeTargetKey(platform, target)}`;
  return `${policyId ?? ''}|global`;
}

function parseTimeToMinutes(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function isInQuietHours(now: Date, start: string, end: string): boolean {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes === undefined || endMinutes === undefined) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return startMinutes <= endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
