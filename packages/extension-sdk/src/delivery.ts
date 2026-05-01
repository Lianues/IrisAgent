import type { ToolAttachment } from './platform.js';
import type { Disposable } from './plugin/service.js';

/** 通用主动投递服务 ID。平台 extension 注册 provider，业务 extension 通过该服务发送消息。 */
export const DELIVERY_REGISTRY_SERVICE_ID = 'delivery.registry';

export type DeliveryTargetKind = 'chat' | 'user' | 'room' | 'channel';

/**
 * 平台投递目标。
 *
 * - Telegram: kind=chat/room, id=chatId, threadId=topic id
 * - Lark/飞书: kind=chat/user, id=open_chat_id/open_id
 * - QQ/微信等平台可通过 raw 扩展自身目标结构
 */
export interface DeliveryTarget {
  kind: DeliveryTargetKind;
  id: string;
  accountId?: string;
  threadId?: string;
  raw?: unknown;
}

export interface DeliveryTextInput {
  platform: string;
  target: DeliveryTarget;
  text: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  policyId?: string;
  urgent?: boolean;
}

export interface DeliveryAttachmentInput {
  platform: string;
  target: DeliveryTarget;
  attachment: ToolAttachment;
  caption?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  policyId?: string;
  urgent?: boolean;
}

export interface DeliveryResult {
  ok: boolean;
  platform: string;
  messageId?: string;
  error?: string;
  raw?: unknown;
  skipped?: boolean;
}

export interface DeliveryCapabilities {
  text: boolean;
  image?: boolean;
  audio?: boolean;
  file?: boolean;
  markdown?: boolean;
  reply?: boolean;
  [key: string]: boolean | undefined;
}

export type DeliveryProviderTextInput = Omit<DeliveryTextInput, 'platform'>;
export type DeliveryProviderAttachmentInput = Omit<DeliveryAttachmentInput, 'platform'>;

export interface PlatformDeliveryProvider {
  platform: string;
  capabilities: DeliveryCapabilities;
  sendText(input: DeliveryProviderTextInput): Promise<DeliveryResult>;
  sendAttachment?(input: DeliveryProviderAttachmentInput): Promise<DeliveryResult>;
}

export interface DeliveryProviderInfo {
  platform: string;
  capabilities: DeliveryCapabilities;
}

export interface DeliveryRecentTarget {
  platform: string;
  target: DeliveryTarget;
  label?: string;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

export interface DeliveryRecentTargetFilter {
  platform?: string;
}

export interface DeliveryRegistryService {
  registerProvider(provider: PlatformDeliveryProvider): Disposable;
  getProvider(platform: string): PlatformDeliveryProvider | undefined;
  listProviders(): DeliveryProviderInfo[];
  registerBinding(binding: DeliveryBinding): Disposable;
  getBinding(id: string): DeliveryBinding | undefined;
  listBindings(): DeliveryBinding[];
  registerPolicy(policy: DeliveryPolicy): Disposable;
  getPolicy(id: string): DeliveryPolicy | undefined;
  listPolicies(): DeliveryPolicy[];
  evaluatePolicy(input: DeliveryPolicyEvaluateInput): Promise<DeliveryPolicyDecision> | DeliveryPolicyDecision;
  recordActivity(input: DeliveryActivityInput): void;
  listRecentTargets(filter?: DeliveryRecentTargetFilter): DeliveryRecentTarget[];
  listSendRecords(filter?: DeliverySendRecordFilter): DeliverySendRecord[];
  sendText(input: DeliveryTextInput): Promise<DeliveryResult>;
  sendAttachment(input: DeliveryAttachmentInput): Promise<DeliveryResult>;
  sendTextToBinding(input: DeliveryBindingTextInput): Promise<DeliveryResult>;
  sendAttachmentToBinding(input: DeliveryBindingAttachmentInput): Promise<DeliveryResult>;
}

/** 预留给后续 binding registry / Web 配置使用。 */
export interface DeliveryBinding {
  id: string;
  label?: string;
  platform: string;
  target: DeliveryTarget;
  defaultSessionId?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  policyId?: string;
}

export interface DeliveryBindingTextInput {
  binding: string;
  text: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  policyId?: string;
  urgent?: boolean;
}

export interface DeliveryBindingAttachmentInput {
  binding: string;
  attachment: ToolAttachment;
  caption?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  policyId?: string;
  urgent?: boolean;
}

export interface DeliveryQuietHoursWindow {
  start: string;
  end: string;
}

export interface DeliveryQuietHoursPolicy {
  enabled: boolean;
  windows: DeliveryQuietHoursWindow[];
  allowUrgent?: boolean;
}

export interface DeliveryRecentActivityPolicy {
  enabled: boolean;
  withinMinutes: number;
}

export interface DeliveryPolicy {
  id: string;
  label?: string;
  enabled?: boolean;
  quietHours?: DeliveryQuietHoursPolicy;
  cooldownMinutes?: number;
  maxPerDay?: number;
  skipIfRecentActivity?: DeliveryRecentActivityPolicy;
  metadata?: Record<string, unknown>;
}

export interface DeliveryPolicyEvaluateInput {
  policyId?: string;
  binding?: string;
  platform?: string;
  target?: DeliveryTarget;
  now?: number;
  urgent?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeliveryPolicyDecision {
  allowed: boolean;
  skipped: boolean;
  policyId?: string;
  reason?: string;
  nextAllowedAt?: number;
}

export interface DeliverySendRecord {
  id: string;
  policyId?: string;
  binding?: string;
  platform: string;
  target: DeliveryTarget;
  sentAt: number;
  ok: boolean;
  messageId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliverySendRecordFilter {
  policyId?: string;
  binding?: string;
  platform?: string;
  since?: number;
}

export interface DeliveryActivityInput {
  platform: string;
  target: DeliveryTarget;
  label?: string;
  occurredAt?: number;
  metadata?: Record<string, unknown>;
}
