/**
 * 部署管理 API 处理器
 *
 * GET  /api/deploy/state   — 获取部署页默认值（来自当前运行配置 + Cloudflare 联动上下文）
 * GET  /api/deploy/detect  — 检测服务器环境（nginx、systemd、sudo）
 * POST /api/deploy/preview         — 统一生成 Nginx / systemd 预览配置
 * POST /api/deploy/sync-cloudflare — 一键同步 Cloudflare SSL 模式
 * POST /api/deploy/nginx           — 一键部署 nginx 配置
 * POST /api/deploy/service         — 一键部署 systemd 服务
 *
 * 安全限制：部署执行接口仅支持 Linux + 部署令牌验证
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import * as crypto from 'crypto';
import { readBody, sendJSON } from '../router';
import { createLogger } from '../../../logger';
import { createDeployPreview } from '../deploy/planner';
import { createDeployState, DeployRuntimeConfig } from '../deploy/defaults';
import { DeployInput, DeployPreviewResult } from '../deploy/types';
import { CloudflareDeployContext, CloudflareSslMode } from '../cloudflare/types';

const logger = createLogger('Deploy');

// ============ 类型 ============

interface DeployStep {
  name: string;
  success: boolean;
  output: string;
}

interface DeployResponse {
  ok: boolean;
  steps: DeployStep[];
  error?: string;
}

interface DeployHandlersOptions {
  host: string;
  port: number;
  getCloudflareDeployContext?: (domain?: string | null) => Promise<CloudflareDeployContext>;
  setCloudflareSslMode?: (mode: Exclude<CloudflareSslMode, 'unknown'>, zoneId?: string | null) => Promise<CloudflareSslMode>;
}

// ============ 工具函数 ============

/** Promise 包装 child_process.exec */
function execCommand(cmd: string, timeout = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { shell: '/bin/sh', timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/** 启动时生成的一次性部署令牌 */
const DEPLOY_TOKEN = crypto.randomBytes(16).toString('hex');

/** 检查部署请求的安全条件：Linux + 令牌验证 */
function assertDeployAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (process.platform !== 'linux') {
    sendJSON(res, 400, { error: '仅支持 Linux 系统' });
    return false;
  }

  const token = req.headers['x-deploy-token'] as string | undefined;
  if (!token || token !== DEPLOY_TOKEN) {
    sendJSON(res, 403, { error: '部署令牌无效。请查看服务端启动日志获取令牌。' });
    return false;
  }

  return true;
}

/** 生成临时文件路径 */
function tmpFilePath(prefix: string, ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `${prefix}-${rand}${ext}`);
}

/** 安全清理临时文件 */
function cleanupTmp(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* 忽略 */ }
}

/** 从请求体提取结构化部署输入 */
function extractDeployInput(body: any): DeployInput {
  if (body?.options && typeof body.options === 'object' && !Array.isArray(body.options)) {
    return body.options;
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body;
  }
  return {};
}

/** 从部署输入中提取域名 */
function extractDomain(input: DeployInput): string | null {
  return typeof input.domain === 'string' && input.domain.trim() ? input.domain.trim() : null;
}

/** 生成部署预览（附带 Cloudflare 联动上下文） */
async function buildPreview(
  body: any,
  runtime: DeployRuntimeConfig,
  getCloudflareDeployContext?: (domain?: string | null) => Promise<CloudflareDeployContext>,
): Promise<DeployPreviewResult> {
  const input = extractDeployInput(body);
  const cloudflare = getCloudflareDeployContext
    ? await getCloudflareDeployContext(extractDomain(input))
    : null;
  return createDeployPreview(input, runtime, cloudflare);
}

/** 根据请求体获取要部署的配置内容（兼容旧 config 文本模式） */
async function resolveConfigContent(
  body: any,
  runtime: DeployRuntimeConfig,
  target: 'nginx' | 'service',
  getCloudflareDeployContext?: (domain?: string | null) => Promise<CloudflareDeployContext>,
): Promise<{ config: string; preview?: DeployPreviewResult } | { error: string; preview?: DeployPreviewResult }> {
  if (typeof body?.config === 'string' && body.config.trim()) {
    return { config: body.config };
  }

  const preview = await buildPreview(body, runtime, getCloudflareDeployContext);
  if (preview.errors.length > 0) {
    return { error: preview.errors.join('；'), preview };
  }

  return {
    config: target === 'nginx' ? preview.nginxConfig : preview.serviceConfig,
    preview,
  };
}

/** 根据 Cloudflare 同步错误推断 HTTP 状态码 */
function statusCodeFromCloudflareSyncError(message: string): number {
  if (
    message.startsWith('未启用 Cloudflare 联动')
    || message.startsWith('mode 必须是')
    || message.startsWith('未配置 Cloudflare')
    || message.includes('多个 zone')
    || message.startsWith('无效的 SSL 模式')
  ) {
    return 400;
  }
  return 500;
}


// ============ 处理器工厂 ============

export function createDeployHandlers(opts: DeployHandlersOptions) {
  const runtimeConfig: DeployRuntimeConfig = { host: opts.host, port: opts.port };

  logger.info(`部署令牌（一键部署需要）: ${DEPLOY_TOKEN}`);

  return {
    /** GET /api/deploy/state — 获取部署页默认值 */
    async state(_req: http.IncomingMessage, res: http.ServerResponse) {
      const cloudflare = opts.getCloudflareDeployContext
        ? await opts.getCloudflareDeployContext(null)
        : null;
      sendJSON(res, 200, createDeployState(runtimeConfig, cloudflare));
    },

    /** GET /api/deploy/detect — 检测服务器环境 */
    async detect(req: http.IncomingMessage, res: http.ServerResponse) {
      const isLinux = process.platform === 'linux';

      // 非 Linux 直接返回基本信息
      if (!isLinux) {
        sendJSON(res, 200, {
          isLinux: false,
          nginx: { installed: false, version: '', configDir: '', existingConfig: false },
          systemd: { available: false, existingService: false, serviceStatus: '' },
          sudo: { available: false, noPassword: false },
        });
        return;
      }

      // 检查 localhost
      const remoteAddr = req.socket.remoteAddress ?? '';
      const loopbackAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
      const isLocal = loopbackAddrs.includes(remoteAddr);

      // nginx 检测
      let nginxInstalled = false;
      let nginxVersion = '';
      let configDir = '';
      let existingConfig = false;

      try {
        const { stderr } = await execCommand('nginx -v');
        const versionMatch = (stderr || '').match(/nginx\/([\d.]+)/);
        if (versionMatch) {
          nginxInstalled = true;
          nginxVersion = versionMatch[1];
        }
      } catch {
        // nginx 未安装
      }

      if (fs.existsSync('/etc/nginx/sites-available')) {
        configDir = 'sites-available';
        existingConfig = fs.existsSync('/etc/nginx/sites-available/irisclaw');
      } else if (fs.existsSync('/etc/nginx/conf.d')) {
        configDir = 'conf.d';
        existingConfig = fs.existsSync('/etc/nginx/conf.d/irisclaw.conf');
      }

      // systemd 检测
      let systemdAvailable = false;
      let existingService = false;
      let serviceStatus = '';

      try {
        await execCommand('systemctl --version');
        systemdAvailable = true;
      } catch { /* systemd 不可用 */ }

      if (systemdAvailable) {
        existingService = fs.existsSync('/etc/systemd/system/irisclaw.service');
        if (existingService) {
          try {
            const { stdout } = await execCommand('systemctl is-active irisclaw 2>/dev/null || true');
            serviceStatus = stdout || 'unknown';
          } catch {
            serviceStatus = 'unknown';
          }
        }
      }

      // sudo 检测
      let sudoAvailable = false;
      let sudoNoPassword = false;

      try {
        await execCommand('which sudo');
        sudoAvailable = true;
        try {
          await execCommand('sudo -n true 2>/dev/null');
          sudoNoPassword = true;
        } catch { /* 需要密码 */ }
      } catch { /* sudo 未安装 */ }

      sendJSON(res, 200, {
        isLinux: true,
        isLocal,
        nginx: { installed: nginxInstalled, version: nginxVersion, configDir, existingConfig },
        systemd: { available: systemdAvailable, existingService, serviceStatus },
        sudo: { available: sudoAvailable, noPassword: sudoNoPassword },
      });
    },

    /** POST /api/deploy/preview — 统一生成配置预览 */
    async preview(req: http.IncomingMessage, res: http.ServerResponse) {
      const body = await readBody(req);
      const preview = await buildPreview(body, runtimeConfig, opts.getCloudflareDeployContext);
      sendJSON(res, 200, preview);
    },

    /** POST /api/deploy/sync-cloudflare — 同步 Cloudflare SSL 模式 */
    async syncCloudflare(req: http.IncomingMessage, res: http.ServerResponse) {
      if (!opts.setCloudflareSslMode) {
        sendJSON(res, 400, { ok: false, error: '未启用 Cloudflare 联动' });
        return;
      }

      try {
        const body = await readBody(req);
        const mode = typeof body?.mode === 'string' ? body.mode.trim().toLowerCase() : '';
        const zoneId = typeof body?.zoneId === 'string' && body.zoneId.trim()
          ? body.zoneId.trim()
          : null;

        const validModes: Array<Exclude<CloudflareSslMode, 'unknown'>> = ['flexible', 'full', 'strict'];
        if (!validModes.includes(mode as Exclude<CloudflareSslMode, 'unknown'>)) {
          sendJSON(res, 400, { ok: false, error: `mode 必须是: ${validModes.join(', ')}` });
          return;
        }

        const updatedMode = await opts.setCloudflareSslMode(mode as Exclude<CloudflareSslMode, 'unknown'>, zoneId);
        sendJSON(res, 200, { ok: true, mode: updatedMode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, statusCodeFromCloudflareSyncError(msg), { ok: false, error: msg });
      }
    },

    /** POST /api/deploy/nginx — 部署 nginx 配置 */
    async nginx(req: http.IncomingMessage, res: http.ServerResponse) {
      if (!assertDeployAuth(req, res)) return;

      const steps: DeployStep[] = [];
      const body = await readBody(req);
      const resolved = await resolveConfigContent(body, runtimeConfig, 'nginx', opts.getCloudflareDeployContext);

      if ('error' in resolved) {
        sendJSON(res, 400, {
          error: resolved.error,
          warnings: resolved.preview?.warnings || [],
          errors: resolved.preview?.errors || [resolved.error],
          recommendations: resolved.preview?.recommendations || [],
          cloudflare: resolved.preview?.cloudflare || null,
        });
        return;
      }

      const config = resolved.config;
      const useSitesAvailable = fs.existsSync('/etc/nginx/sites-available');
      const targetDir = useSitesAvailable ? '/etc/nginx/sites-available' : '/etc/nginx/conf.d';
      const targetFile = useSitesAvailable ? `${targetDir}/irisclaw` : `${targetDir}/irisclaw.conf`;
      const tmpFile = tmpFilePath('irisclaw-nginx', '.conf');

      try {
        try {
          fs.writeFileSync(tmpFile, config, 'utf-8');
          steps.push({ name: '写入临时配置文件', success: true, output: tmpFile });
        } catch (e: any) {
          steps.push({ name: '写入临时配置文件', success: false, output: e.message });
          sendJSON(res, 200, { ok: false, steps, error: '写入临时文件失败' } as DeployResponse);
          return;
        }

        try {
          const { stdout } = await execCommand(`sudo cp "${tmpFile}" "${targetFile}"`);
          steps.push({ name: `复制到 ${targetFile}`, success: true, output: stdout || '完成' });
        } catch (e: any) {
          steps.push({ name: `复制到 ${targetFile}`, success: false, output: e.stderr || e.message });
          sendJSON(res, 200, { ok: false, steps, error: '复制配置文件失败' } as DeployResponse);
          return;
        }

        if (useSitesAvailable) {
          try {
            const linkTarget = '/etc/nginx/sites-enabled/irisclaw';
            const { stdout } = await execCommand(`sudo ln -sf "${targetFile}" "${linkTarget}"`);
            steps.push({ name: '创建 sites-enabled 软链接', success: true, output: stdout || '完成' });
          } catch (e: any) {
            steps.push({ name: '创建 sites-enabled 软链接', success: false, output: e.stderr || e.message });
            await execCommand(`sudo rm -f "${targetFile}"`).catch(() => {});
            sendJSON(res, 200, { ok: false, steps, error: '创建软链接失败' } as DeployResponse);
            return;
          }
        }

        try {
          const { stdout, stderr } = await execCommand('sudo nginx -t 2>&1');
          steps.push({ name: 'nginx 配置测试', success: true, output: stdout || stderr || '语法正确' });
        } catch (e: any) {
          const output = e.stderr || e.stdout || e.message;
          steps.push({ name: 'nginx 配置测试', success: false, output });
          logger.warn('nginx -t 失败，回滚配置');
          await execCommand(`sudo rm -f "${targetFile}"`).catch(() => {});
          if (useSitesAvailable) {
            await execCommand('sudo rm -f /etc/nginx/sites-enabled/irisclaw').catch(() => {});
          }
          sendJSON(res, 200, { ok: false, steps, error: 'nginx 配置测试失败，已回滚' } as DeployResponse);
          return;
        }

        try {
          const { stdout } = await execCommand('sudo systemctl reload nginx');
          steps.push({ name: '重载 nginx', success: true, output: stdout || '完成' });
        } catch (e: any) {
          steps.push({ name: '重载 nginx', success: false, output: e.stderr || e.message });
          sendJSON(res, 200, { ok: false, steps, error: '重载 nginx 失败' } as DeployResponse);
          return;
        }

        sendJSON(res, 200, { ok: true, steps } as DeployResponse);
      } finally {
        cleanupTmp(tmpFile);
      }
    },

    /** POST /api/deploy/service — 部署 systemd 服务 */
    async service(req: http.IncomingMessage, res: http.ServerResponse) {
      if (!assertDeployAuth(req, res)) return;

      const steps: DeployStep[] = [];
      const body = await readBody(req);
      const resolved = await resolveConfigContent(body, runtimeConfig, 'service', opts.getCloudflareDeployContext);

      if ('error' in resolved) {
        sendJSON(res, 400, {
          error: resolved.error,
          warnings: resolved.preview?.warnings || [],
          errors: resolved.preview?.errors || [resolved.error],
          recommendations: resolved.preview?.recommendations || [],
          cloudflare: resolved.preview?.cloudflare || null,
        });
        return;
      }

      const config = resolved.config;
      const tmpFile = tmpFilePath('irisclaw-service', '.service');
      const targetFile = '/etc/systemd/system/irisclaw.service';

      try {
        try {
          fs.writeFileSync(tmpFile, config, 'utf-8');
          steps.push({ name: '写入临时服务文件', success: true, output: tmpFile });
        } catch (e: any) {
          steps.push({ name: '写入临时服务文件', success: false, output: e.message });
          sendJSON(res, 200, { ok: false, steps, error: '写入临时文件失败' } as DeployResponse);
          return;
        }

        try {
          const { stdout } = await execCommand(`sudo cp "${tmpFile}" "${targetFile}"`);
          steps.push({ name: `复制到 ${targetFile}`, success: true, output: stdout || '完成' });
        } catch (e: any) {
          steps.push({ name: `复制到 ${targetFile}`, success: false, output: e.stderr || e.message });
          sendJSON(res, 200, { ok: false, steps, error: '复制服务文件失败' } as DeployResponse);
          return;
        }

        try {
          const { stdout } = await execCommand('sudo systemctl daemon-reload');
          steps.push({ name: 'systemctl daemon-reload', success: true, output: stdout || '完成' });
        } catch (e: any) {
          steps.push({ name: 'systemctl daemon-reload', success: false, output: e.stderr || e.message });
          sendJSON(res, 200, { ok: false, steps, error: 'daemon-reload 失败' } as DeployResponse);
          return;
        }

        try {
          const { stdout } = await execCommand('sudo systemctl enable irisclaw');
          steps.push({ name: 'systemctl enable irisclaw', success: true, output: stdout || '完成' });
        } catch (e: any) {
          steps.push({ name: 'systemctl enable irisclaw', success: false, output: e.stderr || e.message });
          sendJSON(res, 200, { ok: false, steps, error: '启用服务失败' } as DeployResponse);
          return;
        }

        steps.push({
          name: '提示',
          success: true,
          output: '服务已安装并启用。请手动执行: sudo systemctl restart irisclaw',
        });

        sendJSON(res, 200, { ok: true, steps } as DeployResponse);
      } finally {
        cleanupTmp(tmpFile);
      }
    },
  };
}
