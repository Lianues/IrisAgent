/**
 * 部署选项校验
 */

import { CloudflareDeployContext } from '../cloudflare/types';
import { DeployInput, DeployOptions, DeployValidationResult } from './types';

const DOMAIN_PATTERN = /^[a-zA-Z0-9.-]+$/;
const USER_PATTERN = /^[a-z_][a-z0-9_-]*[$]?$/i;

/** 校验部署输入是否合法 */
export function validateDeployOptions(
  input: DeployInput | undefined,
  options: DeployOptions,
  cloudflare?: CloudflareDeployContext | null,
): DeployValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const rawDomain = typeof input?.domain === 'string' ? input.domain.trim() : '';
  if (!rawDomain) {
    errors.push('域名不能为空');
  } else {
    if (!DOMAIN_PATTERN.test(rawDomain)) {
      errors.push('域名格式无效，仅允许字母、数字、点和连字符');
    }
    if (!rawDomain.includes('.')) {
      warnings.push('域名看起来不是完整域名，请确认 DNS 配置是否正确');
    }
  }

  if (input && Object.prototype.hasOwnProperty.call(input, 'port')) {
    const port = input.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('后端端口必须是 1-65535 的整数');
    }
  }

  const rawDeployPath = typeof input?.deployPath === 'string' ? input.deployPath.trim() : null;
  if (rawDeployPath !== null && !rawDeployPath) {
    errors.push('部署路径不能为空');
  }
  if (!options.deployPath.startsWith('/')) {
    errors.push('部署路径必须为 Linux 绝对路径');
  }

  const rawUser = typeof input?.user === 'string' ? input.user.trim() : null;
  if (rawUser !== null && !rawUser) {
    errors.push('运行用户不能为空');
  }
  if (!USER_PATTERN.test(options.user)) {
    errors.push('运行用户格式无效');
  }

  if (!options.enableHttps) {
    warnings.push('当前生成的是 HTTP-only 源站配置；若涉及管理面或敏感令牌录入，不建议通过纯 HTTP 访问。');
  }

  if (cloudflare?.configured && !cloudflare.connected && cloudflare.error) {
    warnings.push(`Cloudflare 已配置，但当前无法获取联动信息：${cloudflare.error}`);
  }

  if (cloudflare?.connected) {
    if (cloudflare.sslMode === 'flexible' && options.enableHttps) {
      errors.push('当前 Cloudflare SSL 模式为 Flexible，源站应保持 HTTP-only。请关闭源站 HTTPS，或先将 Cloudflare 切换到 Full/Strict。');
    }

    if ((cloudflare.sslMode === 'full' || cloudflare.sslMode === 'strict') && !options.enableHttps) {
      errors.push(`当前 Cloudflare SSL 模式为 ${cloudflare.sslMode === 'strict' ? 'Full (Strict)' : 'Full'}，源站必须启用 HTTPS。请开启源站 HTTPS，或先将 Cloudflare 切回 Flexible。`);
    }

    if (cloudflare.sslMode === 'off') {
      warnings.push('当前 Cloudflare SSL 模式为 Off，所有连接均不加密，不建议生产环境使用。');
    }
  }

  return { warnings, errors };
}
