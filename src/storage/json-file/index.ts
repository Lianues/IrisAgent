/**
 * JSON 文件存储提供商
 *
 * 每个 session 对应一个 JSON 文件，内容为 Content[] 数组。
 * 数据存储为原始 Gemini 格式，可直接人工阅读、编辑、调试。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageProvider } from '../base';
import { Content } from '../../types';

export class JsonFileStorage extends StorageProvider {
  private dir: string;
  /** per-session 写锁，防止并发 read-modify-write 竞争 */
  private locks = new Map<string, Promise<void>>();

  constructor(dir: string = './data/sessions') {
    super();
    this.dir = dir;
  }

  async getHistory(sessionId: string): Promise<Content[]> {
    try {
      const data = await fs.readFile(this.filePath(sessionId), 'utf-8');
      return JSON.parse(data) as Content[];
    } catch (err: unknown) {
      // 文件不存在时返回空数组，其他错误（JSON 损坏、权限问题等）向上抛出
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    await this.withLock(sessionId, async () => {
      const history = await this.getHistory(sessionId);
      history.push(this.normalize(content));
      await this.ensureDir();
      await fs.writeFile(this.filePath(sessionId), JSON.stringify(history, null, 2), 'utf-8');
    });
  }

  /** 对同一 sessionId 的写操作串行化，完成后清理锁避免内存泄漏 */
  private async withLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    this.locks.set(sessionId, current);
    await current;
    // 如果当前 promise 仍是最新的，说明没有后续排队，可以清理
    if (this.locks.get(sessionId) === current) {
      this.locks.delete(sessionId);
    }
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    await this.withLock(sessionId, async () => {
      const history = await this.getHistory(sessionId);
      if (history.length <= keepCount) return;
      const truncated = history.slice(0, keepCount);
      await this.ensureDir();
      await fs.writeFile(this.filePath(sessionId), JSON.stringify(truncated, null, 2), 'utf-8');
    });
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.withLock(sessionId, async () => {
      try {
        await fs.unlink(this.filePath(sessionId));
      } catch {
        // 文件不存在则忽略
      }
    });
  }

  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  // ============ 内部方法 ============

  private filePath(sessionId: string): string {
    // 对 sessionId 做简单安全处理，防止路径穿越
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }
}
