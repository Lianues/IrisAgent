import os from 'node:os';
import path from 'node:path';

export function resolveDefaultDataDir(customDataDir?: string): string {
  return path.resolve(customDataDir || process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris'));
}
