import Database from 'better-sqlite3'
import type { UserSetting } from '../types'
import { getDatabase } from '../db'

export class UserSettingsRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  getAll(): UserSetting[] {
    return this.db
      .prepare('SELECT * FROM user_settings ORDER BY key ASC')
      .all() as UserSetting[]
  }

  get(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM user_settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now)
  }

  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM user_settings WHERE key = ?').run(key)
    return result.changes > 0
  }
}
