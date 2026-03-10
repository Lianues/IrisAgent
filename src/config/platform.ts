/**
 * 平台配置解析
 */

import { PlatformConfig } from './types';

export function parsePlatformConfig(raw: any = {}): PlatformConfig {
  return {
    type: (raw.type ?? 'console') as PlatformConfig['type'],
    discord: { token: raw.discord?.token ?? '' },
    telegram: { token: raw.telegram?.token ?? '' },
    web: {
      port: raw.web?.port ?? 8192,
      host: raw.web?.host ?? '127.0.0.1',
      authToken: raw.web?.authToken,
      managementToken: raw.web?.managementToken,
    },
  };
}
