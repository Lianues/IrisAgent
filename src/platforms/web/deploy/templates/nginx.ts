/**
 * Nginx 配置模板生成器
 */

import { CloudflareDeployContext } from '../../cloudflare/types';
import { DeployOptions } from '../types';

const CLOUDFLARE_REAL_IP_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/** Cloudflare 真实 IP 配置块 */
function renderCloudflareRealIpBlock(enabled: boolean, indent = '    '): string {
  const lines = enabled
    ? [
        `${indent}# Cloudflare 真实 IP 还原（已根据当前代理状态自动启用）`,
        ...CLOUDFLARE_REAL_IP_RANGES.map(range => `${indent}set_real_ip_from ${range};`),
        `${indent}real_ip_header CF-Connecting-IP;`,
        `${indent}real_ip_recursive on;`,
      ]
    : [
        `${indent}# Cloudflare 真实 IP 还原（如使用 CF 代理请取消注释）`,
        ...CLOUDFLARE_REAL_IP_RANGES.map(range => `${indent}# set_real_ip_from ${range};`),
        `${indent}# real_ip_header CF-Connecting-IP;`,
        `${indent}# real_ip_recursive on;`,
      ];
  return lines.join('\n');
}

/** 可选的 Basic Auth 配置块 */
function renderAuthBlock(enableAuth: boolean): string {
  if (!enableAuth) return '';
  return [
    '    auth_basic "IrisClaw";',
    '    auth_basic_user_file /etc/nginx/.htpasswd;',
  ].join('\n');
}

/** SSE 专用 location */
function renderSseLocation(port: number): string {
  return [
    '    # SSE 专用：/api/chat',
    '    location /api/chat {',
    `        proxy_pass http://127.0.0.1:${port};`,
    '',
    '        # 关键：关闭代理缓冲，确保 SSE 实时到达',
    '        proxy_buffering off;',
    '        proxy_cache off;',
    '        chunked_transfer_encoding off;',
    '',
    '        # SSE 连接可能持续较长时间（工具执行等）',
    '        proxy_read_timeout 300s;',
    '        proxy_send_timeout 300s;',
    '',
    '        proxy_set_header Connection \'\';',
    '        proxy_http_version 1.1;',
    '',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '    }',
  ].join('\n');
}

/** 通用反向代理 location */
function renderGeneralLocation(port: number): string {
  return [
    '    location / {',
    `        proxy_pass http://127.0.0.1:${port};`,
    '        proxy_http_version 1.1;',
    '',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '',
    '        # WebSocket 支持（如果将来需要）',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";',
    '    }',
  ].join('\n');
}

/** 生成 Nginx 配置 */
export function generateNginxConfig(options: DeployOptions, cloudflare?: CloudflareDeployContext | null): string {
  const authBlock = renderAuthBlock(options.enableAuth);
  const cfRealIpBlock = renderCloudflareRealIpBlock(cloudflare?.domainRecordProxied === true);
  const sseLocation = renderSseLocation(options.port);
  const generalLocation = renderGeneralLocation(options.port);
  const sections = [cfRealIpBlock, authBlock, sseLocation, generalLocation].filter(Boolean).join('\n\n');

  if (!options.enableHttps) {
    return [
      'server {',
      '    listen 80;',
      '    listen [::]:80;',
      `    server_name ${options.domain};`,
      '',
      '    # 安全头',
      '    add_header X-Frame-Options DENY always;',
      '    add_header X-Content-Type-Options nosniff always;',
      '    add_header X-XSS-Protection "1; mode=block" always;',
      '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
      '',
      sections,
      '}',
    ].join('\n');
  }

  return [
    '# HTTP → HTTPS 重定向',
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    `    server_name ${options.domain};`,
    '',
    '    location /.well-known/acme-challenge/ {',
    '        root /var/www/certbot;',
    '    }',
    '',
    '    location / {',
    '        return 301 https://$host$request_uri;',
    '    }',
    '}',
    '',
    '# HTTPS 主站',
    'server {',
    '    listen 443 ssl http2;',
    '    listen [::]:443 ssl http2;',
    `    server_name ${options.domain};`,
    '',
    '    # SSL 证书（Let\'s Encrypt）',
    `    ssl_certificate     /etc/letsencrypt/live/${options.domain}/fullchain.pem;`,
    `    ssl_certificate_key /etc/letsencrypt/live/${options.domain}/privkey.pem;`,
    '',
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_ciphers HIGH:!aNULL:!MD5;',
    '    ssl_prefer_server_ciphers on;',
    '    ssl_session_cache shared:SSL:10m;',
    '    ssl_session_timeout 10m;',
    '',
    '    # 安全头',
    '    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;',
    '    add_header X-Frame-Options DENY always;',
    '    add_header X-Content-Type-Options nosniff always;',
    '    add_header X-XSS-Protection "1; mode=block" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '',
    sections,
    '}',
  ].join('\n');
}
