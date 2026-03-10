/**
 * Cloudflare 领域类型定义
 */

export type CloudflareTokenSource = 'inline' | 'env' | 'file';

export type CloudflareSslMode = 'off' | 'flexible' | 'full' | 'strict' | 'unknown';

/** config.yaml 中保存的 Cloudflare 配置 */
export interface StoredCloudflareConfig {
  apiToken?: string;
  apiTokenEnv?: string;
  apiTokenFile?: string;
  zoneId?: string;
}

/** 解析后的有效 Cloudflare 凭据 */
export interface ResolvedCloudflareCredentials {
  apiToken: string;
  zoneId: string;
  tokenSource: CloudflareTokenSource;
}

/** Cloudflare zone 摘要 */
export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

/** Cloudflare DNS 记录 */
export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

/** Cloudflare 状态摘要（供设置页使用） */
export interface CloudflareStatusSummary {
  configured: boolean;
  connected: boolean;
  zones: CloudflareZone[];
  activeZoneId: string | null;
  activeZoneName: string | null;
  sslMode: CloudflareSslMode | null;
  tokenSource?: CloudflareTokenSource | null;
  error?: string;
}

/** 部署规划用 Cloudflare 上下文 */
export interface CloudflareDeployContext {
  configured: boolean;
  connected: boolean;
  zoneId: string | null;
  zoneName: string | null;
  sslMode: CloudflareSslMode | null;
  domain: string | null;
  domainRecordProxied: boolean | null;
  tokenSource?: CloudflareTokenSource | null;
  error?: string;
}

/** 解析结果：无配置、已配置但解析失败、已配置且可用 */
export interface CloudflareCredentialsResult {
  configured: boolean;
  stored: StoredCloudflareConfig | null;
  resolved: ResolvedCloudflareCredentials | null;
  error?: string;
}
