export function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false };
  }
  const marker = `\n\n... (已截断，共 ${text.length} 字符) ...\n\n`;
  if (marker.length >= maxChars) {
    return { text: text.slice(0, maxChars), truncated: true };
  }
  const keep = Math.floor((maxChars - marker.length) / 2);
  const head = text.slice(0, keep);
  const tail = text.slice(text.length - keep);
  return { text: head + marker + tail, truncated: true };
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, '')
    .replace(/\r/g, '');
}

export function normalizeDisplayLines(lines: string[]): string {
  const normalized = lines.map(line => line.replace(/\s+$/g, ''));
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  return normalized.join('\n');
}
