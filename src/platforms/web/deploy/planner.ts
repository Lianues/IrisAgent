/**
 * 部署预览规划器
 *
 * 负责：
 * - 从前端输入与运行时默认值生成标准化部署选项
 * - 统一产出 Nginx / systemd 预览文本
 * - 输出校验错误、警告与联动建议
 */

import { CloudflareDeployContext } from '../cloudflare/types';
import { PREVIEW_DOMAIN, createDeployDefaults, DeployRuntimeConfig } from './defaults';
import { generateNginxConfig } from './templates/nginx';
import { generateServiceConfig } from './templates/service';
import { DeployInput, DeployOptions, DeployPreviewResult } from './types';
import { validateDeployOptions } from './validation';

/** 标准化字符串输入 */
function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** 标准化端口 */
function normalizePort(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

/** 标准化布尔值 */
function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 生成联动建议 */
function buildRecommendations(options: DeployOptions, cloudflare?: CloudflareDeployContext | null): string[] {
  const recommendations: string[] = [];

  if (!cloudflare) return recommendations;

  if (!cloudflare.configured) {
    recommendations.push('尚未连接 Cloudflare，当前按纯源站模式生成配置。');
    return recommendations;
  }

  if (!cloudflare.connected) {
    recommendations.push(cloudflare.error
      ? `Cloudflare 已配置，但当前无法联动：${cloudflare.error}`
      : 'Cloudflare 已配置，但当前未建立可用连接。');
    return recommendations;
  }

  if (cloudflare.zoneName) {
    recommendations.push(`已接入 Cloudflare zone：${cloudflare.zoneName}`);
  }

  if (cloudflare.sslMode === 'flexible' && !options.enableHttps) {
    recommendations.push('当前 Cloudflare SSL 模式为 Flexible，已保持源站 HTTP-only 配置。');
  }

  if ((cloudflare.sslMode === 'full' || cloudflare.sslMode === 'strict') && options.enableHttps) {
    recommendations.push(`当前 Cloudflare SSL 模式为 ${cloudflare.sslMode === 'strict' ? 'Full (Strict)' : 'Full'}，已保持源站 HTTPS 配置。`);
  }

  if (cloudflare.domain && cloudflare.domainRecordProxied === true) {
    recommendations.push('检测到目标域名 DNS 记录已开启 Cloudflare 代理，Nginx 将自动启用真实 IP 还原。');
  } else if (cloudflare.domain && cloudflare.domainRecordProxied === false) {
    recommendations.push('检测到目标域名 DNS 记录未开启 Cloudflare 代理，Nginx 将保留 Cloudflare 真实 IP 配置为注释状态。');
  } else if (cloudflare.domain) {
    recommendations.push('未在 Cloudflare 中找到该域名的 DNS 记录，Nginx 暂不自动启用真实 IP 还原。');
  }

  return recommendations;
}

/** 基于输入与默认值生成归一化部署选项 */
export function resolveDeployOptions(
  input: DeployInput | undefined,
  runtime: DeployRuntimeConfig,
  cloudflare?: CloudflareDeployContext | null,
): DeployOptions {
  const defaults = createDeployDefaults(runtime, cloudflare);
  return {
    domain: normalizeString(input?.domain, PREVIEW_DOMAIN),
    port: normalizePort(input?.port, defaults.port),
    deployPath: normalizeString(input?.deployPath, defaults.deployPath),
    user: normalizeString(input?.user, defaults.user),
    enableHttps: normalizeBoolean(input?.enableHttps, defaults.enableHttps),
    enableAuth: normalizeBoolean(input?.enableAuth, defaults.enableAuth),
  };
}

/** 统一生成部署预览 */
export function createDeployPreview(
  input: DeployInput | undefined,
  runtime: DeployRuntimeConfig,
  cloudflare?: CloudflareDeployContext | null,
): DeployPreviewResult {
  const options = resolveDeployOptions(input, runtime, cloudflare);
  const validation = validateDeployOptions(input, options, cloudflare);

  return {
    options,
    nginxConfig: generateNginxConfig(options, cloudflare),
    serviceConfig: generateServiceConfig(options),
    warnings: validation.warnings,
    errors: validation.errors,
    recommendations: buildRecommendations(options, cloudflare),
    cloudflare: cloudflare || null,
  };
}
