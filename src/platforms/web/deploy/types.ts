/**
 * 部署配置领域类型定义
 */

import { CloudflareDeployContext } from '../cloudflare/types';

/** 部署表单输入 */
export interface DeployInput {
  domain?: string;
  port?: number;
  deployPath?: string;
  user?: string;
  enableHttps?: boolean;
  enableAuth?: boolean;
}

/** 部署默认值（供前端初始化表单） */
export interface DeployDefaults {
  domain: string;
  port: number;
  deployPath: string;
  user: string;
  enableHttps: boolean;
  enableAuth: boolean;
}

/** 归一化后的部署选项 */
export interface DeployOptions {
  domain: string;
  port: number;
  deployPath: string;
  user: string;
  enableHttps: boolean;
  enableAuth: boolean;
}

/** 部署配置校验结果 */
export interface DeployValidationResult {
  warnings: string[];
  errors: string[];
}

/** 统一部署预览结果 */
export interface DeployPreviewResult extends DeployValidationResult {
  options: DeployOptions;
  nginxConfig: string;
  serviceConfig: string;
  recommendations: string[];
  cloudflare: CloudflareDeployContext | null;
}

/** 部署页初始化状态 */
export interface DeployState {
  web: {
    host: string;
    port: number;
  };
  defaults: DeployDefaults;
  cloudflare: CloudflareDeployContext | null;
}
