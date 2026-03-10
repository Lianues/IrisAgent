/**
 * systemd 服务文件模板生成器
 */

import { DeployOptions } from '../types';

/** 生成 systemd 服务文件 */
export function generateServiceConfig(options: DeployOptions): string {
  return [
    '[Unit]',
    'Description=IrisClaw AI Chat Service',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    '',
    `WorkingDirectory=${options.deployPath}`,
    '',
    'ExecStart=/usr/bin/node dist/index.js',
    '',
    `User=${options.user}`,
    `Group=${options.user}`,
    '',
    'Environment=NODE_ENV=production',
    '',
    'Restart=on-failure',
    'RestartSec=5',
    '',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    `ReadWritePaths=${options.deployPath}/data`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}
