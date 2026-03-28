export interface PairingConfig {
  /** DM 策略：pairing = 需要对码（默认）| allowlist = 仅白名单 | open = 任何人 */
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  /** 管理员 ID，格式 <platform>:<userId>（可选，直接指定则跳过首次对码） */
  admin?: string;
  /** 预设白名单，格式 <platform>:<userId>（可选） */
  allowFrom?: string[];
}

export interface PendingPairing {
  code: string;
  platform: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AllowedUser {
  platform: string;
  userId: string;
  userName?: string;
  pairedAt: number;
}

export interface PairingAdmin {
  platform: string;
  userId: string;
  userName?: string;
  setAt: number;
  source: 'first-pairing' | 'config' | 'transfer';
}

export interface PairingCheckResult {
  allowed: boolean;
  reason?: 'needs-pairing' | 'bootstrap-success' | 'pairing-success';
  replyText?: string;
}
