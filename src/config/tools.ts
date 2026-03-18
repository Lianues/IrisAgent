/**
 * 工具配置解析
 */

import { ToolsConfig, ToolPolicyConfig } from './types';

function parsePatternList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const patterns = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(s => s.trim());
  return patterns.length > 0 ? patterns : undefined;
}

function normalizeToolPolicy(raw: unknown): ToolPolicyConfig | undefined {
  if (typeof raw === 'boolean') {
    return { autoApprove: raw };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const policy: ToolPolicyConfig = {
    autoApprove: record.autoApprove === true,
  };

  if (typeof record.showApprovalView === 'boolean') policy.showApprovalView = record.showApprovalView;

  const allow = parsePatternList(record.allowPatterns);
  if (allow) policy.allowPatterns = allow;

  const deny = parsePatternList(record.denyPatterns);
  if (deny) policy.denyPatterns = deny;

  return policy;
}

export function parseToolsConfig(raw: any): ToolsConfig {
  const permissions: Record<string, ToolPolicyConfig> = {};

  const globalConfig: Pick<ToolsConfig, 'autoApproveAll' | 'autoApproveConfirmation' | 'autoApproveDiff'> = {};

  // 保留字段名集合（全局开关，不作为工具名解析）
  const RESERVED_KEYS = new Set(['autoApproveAll', 'autoApproveConfirmation', 'autoApproveDiff']);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { permissions };
  }

  if (raw.autoApproveAll === true) globalConfig.autoApproveAll = true;
  if (raw.autoApproveConfirmation === true) globalConfig.autoApproveConfirmation = true;
  if (raw.autoApproveDiff === true) globalConfig.autoApproveDiff = true;

  for (const [toolName, value] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(toolName)) continue;
    const policy = normalizeToolPolicy(value);
    if (!policy) continue;
    permissions[toolName] = policy;
  }

  return { ...globalConfig, permissions };
}
