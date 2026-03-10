/**
 * SQLite 存储提供商
 *
 * 使用 better-sqlite3（同步 API）实现，包装为 async 接口。
 * 开启 WAL 模式，天然支持并发读写，无需手动加锁。
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { StorageProvider } from '../base';
import { Content } from '../../types';

export class SqliteStorage extends StorageProvider {
  private db: Database.Database;

  constructor(dbPath: string = './data/iris.db') {
    super();

    // 确保父目录存在
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    // 开启 WAL 模式，提升并发性能
    this.db.pragma('journal_mode = WAL');

    // 建表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    `);
  }

  async getHistory(sessionId: string): Promise<Content[]> {
    const rows = this.db
      .prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY id')
      .all(sessionId) as { content: string }[];
    return rows.map(row => JSON.parse(row.content) as Content);
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    const normalized = this.normalize(content);
    this.db
      .prepare('INSERT INTO messages (session_id, content) VALUES (?, ?)')
      .run(sessionId, JSON.stringify(normalized));
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    this.db
      .prepare(
        `DELETE FROM messages WHERE session_id = ? AND id NOT IN (
          SELECT id FROM messages WHERE session_id = ? ORDER BY id LIMIT ?
        )`
      )
      .run(sessionId, sessionId, keepCount);
  }

  async clearHistory(sessionId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM messages WHERE session_id = ?')
      .run(sessionId);
  }

  async listSessions(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT session_id FROM messages')
      .all() as { session_id: string }[];
    return rows.map(row => row.session_id);
  }

}
