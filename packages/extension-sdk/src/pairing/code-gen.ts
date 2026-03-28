const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePairingCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}
