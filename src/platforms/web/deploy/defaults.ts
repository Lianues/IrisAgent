/**
 * 部署配置默认值与运行时状态
 */

import { CloudflareDeployContext } from '../cloudflare/types';
import { DeployDefaults, DeployState } from './types';

export interface DeployRuntimeConfig {
  host: string;
  port: number;
}

/** 预览用示例域名（当用户尚未填写域名时用于生成预览） */
export const PREVIEW_DOMAIN = 'chat.example.com';

/** 默认部署路径 */
export const DEFAULT_DEPLOY_PATH = '/opt/irisclaw';

/** 默认运行用户 */
export const DEFAULT_DEPLOY_USER = 'irisclaw';

/** 基于 Cloudflare 联动状态推导默认 HTTPS 选项 */
function resolveDefaultEnableHttps(cloudflare?: CloudflareDeployContext | null): boolean {
  if (cloudflare?.connected && cloudflare.sslMode === 'flexible') return false;
  return true;
}

/** 基于当前运行配置生成部署表单默认值 */
export function createDeployDefaults(runtime: DeployRuntimeConfig, cloudflare?: CloudflareDeployContext | null): DeployDefaults {
  return {
    domain: '',
    port: runtime.port,
    deployPath: DEFAULT_DEPLOY_PATH,
    user: DEFAULT_DEPLOY_USER,
    enableHttps: resolveDefaultEnableHttps(cloudflare),
    enableAuth: false,
  };
}

/** 生成部署页所需的初始化状态 */
export function createDeployState(runtime: DeployRuntimeConfig, cloudflare?: CloudflareDeployContext | null): DeployState {
  return {
    web: {
      host: runtime.host,
      port: runtime.port,
    },
    defaults: createDeployDefaults(runtime, cloudflare),
    cloudflare: cloudflare || null,
  };
}
