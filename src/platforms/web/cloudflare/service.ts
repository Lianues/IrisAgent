/**
 * Cloudflare 领域服务
 */

import { createLogger } from '../../../logger';
import { CloudflareApiClient } from './client';
import { resolveCloudflareCredentials, saveInlineCloudflareConfig } from './config-store';
import {
  CloudflareDeployContext,
  CloudflareDnsRecord,
  CloudflareSslMode,
  CloudflareStatusSummary,
  CloudflareZone,
} from './types';

const logger = createLogger('Cloudflare');

/** Cloudflare 领域服务 */
export class CloudflareService {
  constructor(private readonly configPath: string) {}

  /** 获取 Cloudflare 连接状态 */
  async getStatus(): Promise<CloudflareStatusSummary> {
    const prepared = this.prepareClient();
    if (!prepared.configured) {
      return {
        configured: false,
        connected: false,
        zones: [],
        activeZoneId: null,
        activeZoneName: null,
        sslMode: null,
        tokenSource: null,
      };
    }

    if (!prepared.client) {
      return {
        configured: true,
        connected: false,
        zones: [],
        activeZoneId: null,
        activeZoneName: null,
        sslMode: null,
        tokenSource: prepared.tokenSource,
        error: prepared.error,
      };
    }

    try {
      const verified = await prepared.client.verifyToken();
      if (!verified) {
        return {
          configured: true,
          connected: false,
          zones: [],
          activeZoneId: null,
          activeZoneName: null,
          sslMode: null,
          tokenSource: prepared.tokenSource,
        };
      }

      const zones = await prepared.client.listZones();
      const activeZone = this.resolvePreferredZone(zones, prepared.zoneId, null);
      let sslMode: CloudflareSslMode | null = null;
      if (activeZone) {
        try {
          sslMode = await prepared.client.getSslMode(activeZone.id);
        } catch {
          sslMode = null;
        }
      }

      return {
        configured: true,
        connected: true,
        zones,
        activeZoneId: activeZone?.id ?? null,
        activeZoneName: activeZone?.name ?? null,
        sslMode,
        tokenSource: prepared.tokenSource,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Cloudflare 状态检查失败:', msg);
      return {
        configured: true,
        connected: false,
        zones: [],
        activeZoneId: null,
        activeZoneName: null,
        sslMode: null,
        tokenSource: prepared.tokenSource,
        error: msg,
      };
    }
  }

  /** 获取部署规划用的 Cloudflare 上下文 */
  async getDeployContext(domain?: string | null): Promise<CloudflareDeployContext> {
    const normalizedDomain = typeof domain === 'string' && domain.trim() ? domain.trim().toLowerCase() : null;
    const prepared = this.prepareClient();

    if (!prepared.configured) {
      return {
        configured: false,
        connected: false,
        zoneId: null,
        zoneName: null,
        sslMode: null,
        domain: normalizedDomain,
        domainRecordProxied: null,
        tokenSource: null,
      };
    }

    if (!prepared.client) {
      return {
        configured: true,
        connected: false,
        zoneId: null,
        zoneName: null,
        sslMode: null,
        domain: normalizedDomain,
        domainRecordProxied: null,
        tokenSource: prepared.tokenSource,
        error: prepared.error,
      };
    }

    try {
      const verified = await prepared.client.verifyToken();
      if (!verified) {
        return {
          configured: true,
          connected: false,
          zoneId: null,
          zoneName: null,
          sslMode: null,
          domain: normalizedDomain,
          domainRecordProxied: null,
          tokenSource: prepared.tokenSource,
        };
      }

      const zones = await prepared.client.listZones();
      const activeZone = this.resolvePreferredZone(zones, prepared.zoneId, normalizedDomain);
      if (!activeZone) {
        return {
          configured: true,
          connected: true,
          zoneId: null,
          zoneName: null,
          sslMode: null,
          domain: normalizedDomain,
          domainRecordProxied: null,
          tokenSource: prepared.tokenSource,
          error: zones.length > 1 ? '检测到多个 zone，请在 Cloudflare 配置中固定 zoneId 或使用匹配域名。' : undefined,
        };
      }

      const sslMode = await prepared.client.getSslMode(activeZone.id);
      let domainRecordProxied: boolean | null = null;

      if (normalizedDomain) {
        const records = await prepared.client.listDnsRecords(activeZone.id, {
          name: normalizedDomain,
          perPage: '50',
        });
        const exact = records.find(record => record.name.toLowerCase() === normalizedDomain);
        domainRecordProxied = exact ? !!exact.proxied : null;
      }

      return {
        configured: true,
        connected: true,
        zoneId: activeZone.id,
        zoneName: activeZone.name,
        sslMode,
        domain: normalizedDomain,
        domainRecordProxied,
        tokenSource: prepared.tokenSource,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        configured: true,
        connected: false,
        zoneId: null,
        zoneName: null,
        sslMode: null,
        domain: normalizedDomain,
        domainRecordProxied: null,
        tokenSource: prepared.tokenSource,
        error: msg,
      };
    }
  }

  /** 列出 DNS 记录 */
  async listDns(zoneId?: string | null, page = '1', perPage = '50'): Promise<CloudflareDnsRecord[]> {
    const prepared = this.requireClient();
    const effectiveZoneId = await this.resolveZoneId(prepared.client, prepared.zoneId, zoneId);
    return prepared.client.listDnsRecords(effectiveZoneId, { page, perPage });
  }

  /** 添加 DNS 记录 */
  async addDns(input: {
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
    ttl?: number;
    zoneId?: string | null;
  }): Promise<any> {
    if (!input.type || !input.name || !input.content) {
      throw new Error('缺少必填字段: type, name, content');
    }

    const prepared = this.requireClient();
    const effectiveZoneId = await this.resolveZoneId(prepared.client, prepared.zoneId, input.zoneId);
    return prepared.client.addDnsRecord(effectiveZoneId, {
      type: input.type,
      name: input.name,
      content: input.content,
      proxied: input.proxied,
      ttl: input.ttl,
    });
  }

  /** 删除 DNS 记录 */
  async removeDns(recordId: string, zoneId?: string | null): Promise<void> {
    if (!recordId) throw new Error('缺少记录 ID');
    const prepared = this.requireClient();
    const effectiveZoneId = await this.resolveZoneId(prepared.client, prepared.zoneId, zoneId);
    await prepared.client.removeDnsRecord(effectiveZoneId, recordId);
  }

  /** 获取 SSL 模式 */
  async getSsl(zoneId?: string | null): Promise<CloudflareSslMode> {
    const prepared = this.requireClient();
    const effectiveZoneId = await this.resolveZoneId(prepared.client, prepared.zoneId, zoneId);
    return prepared.client.getSslMode(effectiveZoneId);
  }

  /** 设置 SSL 模式 */
  async setSsl(mode: string, zoneId?: string | null): Promise<CloudflareSslMode> {
    const validModes: Array<Exclude<CloudflareSslMode, 'unknown'>> = ['off', 'flexible', 'full', 'strict'];
    if (!validModes.includes(mode as Exclude<CloudflareSslMode, 'unknown'>)) {
      throw new Error(`无效的 SSL 模式，可选: ${validModes.join(', ')}`);
    }

    const prepared = this.requireClient();
    const effectiveZoneId = await this.resolveZoneId(prepared.client, prepared.zoneId, zoneId);
    return prepared.client.setSslMode(effectiveZoneId, mode as Exclude<CloudflareSslMode, 'unknown'>);
  }

  /** 首次接入：验证 token 并写入 config.yaml */
  async setupInlineToken(apiToken: string): Promise<{ zones: Array<{ id: string; name: string }> }> {
    if (!apiToken || typeof apiToken !== 'string') {
      throw new Error('请提供 API Token');
    }

    const client = new CloudflareApiClient(apiToken.trim());
    const verified = await client.verifyToken();
    if (!verified) {
      throw new Error('Token 验证失败: 无效的 Token');
    }

    const zones = await client.listZones();
    saveInlineCloudflareConfig(this.configPath, apiToken.trim(), zones.length === 1 ? zones[0].id : 'auto');
    logger.info('Cloudflare 配置已保存');
    return {
      zones: zones.map(zone => ({ id: zone.id, name: zone.name })),
    };
  }

  /** 创建可用客户端 */
  private prepareClient(): {
    configured: boolean;
    client: CloudflareApiClient | null;
    zoneId: string;
    tokenSource: 'inline' | 'env' | 'file' | null;
    error?: string;
  } {
    const resolved = resolveCloudflareCredentials(this.configPath);
    return {
      configured: resolved.configured,
      client: resolved.resolved ? new CloudflareApiClient(resolved.resolved.apiToken) : null,
      zoneId: resolved.resolved?.zoneId || resolved.stored?.zoneId || '',
      tokenSource: resolved.resolved?.tokenSource || null,
      error: resolved.error,
    };
  }

  /** 要求存在有效客户端 */
  private requireClient(): { client: CloudflareApiClient; zoneId: string } {
    const prepared = this.prepareClient();
    if (!prepared.configured || !prepared.client) {
      throw new Error(prepared.error || '未配置 Cloudflare');
    }
    return { client: prepared.client, zoneId: prepared.zoneId };
  }

  /** 获取有效 zoneId：请求参数 > 匹配域名 > 配置文件 > 自动检测 */
  private async resolveZoneId(client: CloudflareApiClient, configuredZoneId: string, overrideZoneId?: string | null, domain?: string | null): Promise<string> {
    if (overrideZoneId) return overrideZoneId;

    const zones = await client.listZones();
    const zone = this.resolvePreferredZone(zones, configuredZoneId, domain);
    if (!zone) {
      throw new Error('检测到多个 zone，请在请求中指定 zoneId 参数');
    }
    return zone.id;
  }

  /** 确定优先 zone */
  private resolvePreferredZone(zones: CloudflareZone[], configuredZoneId: string, domain?: string | null): CloudflareZone | null {
    if (configuredZoneId && configuredZoneId !== 'auto') {
      return zones.find(zone => zone.id === configuredZoneId) || null;
    }

    const domainMatched = this.matchZoneByDomain(zones, domain);
    if (domainMatched) return domainMatched;

    if (zones.length === 1) return zones[0];
    return null;
  }

  /** 根据域名匹配最合适的 zone（最长后缀优先） */
  private matchZoneByDomain(zones: CloudflareZone[], domain?: string | null): CloudflareZone | null {
    if (!domain) return null;
    const normalizedDomain = domain.trim().toLowerCase();

    const candidates = zones
      .filter(zone => {
        const zoneName = zone.name.toLowerCase();
        return normalizedDomain === zoneName || normalizedDomain.endsWith(`.${zoneName}`);
      })
      .sort((a, b) => b.name.length - a.name.length);

    return candidates[0] || null;
  }
}
