/**
 * Cloudflare REST API 客户端
 */

import * as https from 'https';
import { CloudflareDnsRecord, CloudflareSslMode, CloudflareZone } from './types';

const CF_API = 'https://api.cloudflare.com/client/v4';

interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
}

interface CloudflareRequestOptions {
  method?: string;
  body?: unknown;
}

/** Cloudflare REST API 客户端 */
export class CloudflareApiClient {
  constructor(private readonly apiToken: string) {}

  /** 验证 Token 是否有效 */
  async verifyToken(): Promise<boolean> {
    const result = await this.request<any>('/user/tokens/verify');
    return !!result.success;
  }

  /** 列出当前 token 可访问的 zones */
  async listZones(): Promise<CloudflareZone[]> {
    const result = await this.request<any[]>('/zones');
    if (!result.success) throw new Error(result.errors?.[0]?.message || '获取 zone 列表失败');
    return (result.result || []).map((zone: any) => ({
      id: zone.id,
      name: zone.name,
      status: zone.status,
    }));
  }

  /** 列出 DNS 记录，可按 name 精确查询 */
  async listDnsRecords(zoneId: string, options: { page?: string; perPage?: string; name?: string } = {}): Promise<CloudflareDnsRecord[]> {
    const params = new URLSearchParams();
    if (options.page) params.set('page', options.page);
    if (options.perPage) params.set('per_page', options.perPage);
    if (options.name) params.set('name', options.name);
    const suffix = params.toString() ? `?${params.toString()}` : '';

    const result = await this.request<any[]>(`/zones/${zoneId}/dns_records${suffix}`);
    if (!result.success) throw new Error(result.errors?.[0]?.message || 'DNS 查询失败');
    return (result.result || []).map((record: any) => ({
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      proxied: !!record.proxied,
      ttl: record.ttl,
    }));
  }

  /** 添加 DNS 记录 */
  async addDnsRecord(zoneId: string, record: {
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
    ttl?: number;
  }): Promise<any> {
    const result = await this.request<any>(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: record,
    });
    if (!result.success) throw new Error(result.errors?.[0]?.message || '添加 DNS 记录失败');
    return result.result;
  }

  /** 删除 DNS 记录 */
  async removeDnsRecord(zoneId: string, recordId: string): Promise<void> {
    const result = await this.request<any>(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
    });
    if (!result.success) throw new Error(result.errors?.[0]?.message || '删除 DNS 记录失败');
  }

  /** 获取 SSL 模式 */
  async getSslMode(zoneId: string): Promise<CloudflareSslMode> {
    const result = await this.request<any>(`/zones/${zoneId}/settings/ssl`);
    if (!result.success) throw new Error(result.errors?.[0]?.message || '获取 SSL 模式失败');
    return (result.result?.value || 'unknown') as CloudflareSslMode;
  }

  /** 设置 SSL 模式 */
  async setSslMode(zoneId: string, mode: Exclude<CloudflareSslMode, 'unknown'>): Promise<CloudflareSslMode> {
    const result = await this.request<any>(`/zones/${zoneId}/settings/ssl`, {
      method: 'PATCH',
      body: { value: mode },
    });
    if (!result.success) throw new Error(result.errors?.[0]?.message || '设置 SSL 模式失败');
    return (result.result?.value || mode) as CloudflareSslMode;
  }

  /** 发送请求到 Cloudflare REST API */
  private request<T>(path: string, options: CloudflareRequestOptions = {}): Promise<CloudflareApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const url = new URL(CF_API + path);
      const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

      const req = https.request(url, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('Cloudflare API 响应解析失败'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Cloudflare API 请求超时'));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}
