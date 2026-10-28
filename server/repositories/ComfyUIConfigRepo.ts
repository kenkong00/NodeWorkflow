import Database from 'better-sqlite3'
import type { ComfyUIConfig } from '../types'
import { getDatabase } from '../db'

export class ComfyUIConfigRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): ComfyUIConfig[] {
    return this.db
      .prepare('SELECT * FROM comfyui_configs ORDER BY created_at ASC')
      .all() as ComfyUIConfig[]
  }

  findActive(): ComfyUIConfig | undefined {
    return this.db
      .prepare('SELECT * FROM comfyui_configs WHERE is_active = 1 LIMIT 1')
      .get() as ComfyUIConfig | undefined
  }

  findById(id: string): ComfyUIConfig | undefined {
    return this.db
      .prepare('SELECT * FROM comfyui_configs WHERE id = ?')
      .get(id) as ComfyUIConfig | undefined
  }

  create(data: Omit<ComfyUIConfig, 'id' | 'created_at' | 'updated_at'>): ComfyUIConfig {
    const id = `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO comfyui_configs (id, name, url, timeout, auto_connect, is_active, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.name || '新配置',
        data.url,
        data.timeout || 30000,
        data.auto_connect ? 1 : 0,
        data.is_active ? 1 : 0,
        data.notes || '',
        now,
        now
      )

    if (data.is_active) {
      this.setActive(id)
    }

    return this.findById(id)!
  }

  update(id: string, data: Partial<ComfyUIConfig>): ComfyUIConfig | null {
    const existing = this.findById(id)
    if (!existing) return null

    const fields: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.url !== undefined) { fields.push('url = ?'); values.push(data.url) }
    if (data.timeout !== undefined) { fields.push('timeout = ?'); values.push(data.timeout) }
    if (data.auto_connect !== undefined) { fields.push('auto_connect = ?'); values.push(data.auto_connect ? 1 : 0) }
    if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db
      .prepare(`UPDATE comfyui_configs SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    if (data.is_active && !existing.is_active) {
      this.setActive(id)
    }

    return this.findById(id) ?? null
  }

  setActive(id: string): void {
    this.db.prepare('UPDATE comfyui_configs SET is_active = 0').run()
    this.db.prepare('UPDATE comfyui_configs SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  delete(id: string): boolean {
    const existing = this.findById(id)
    if (!existing) return false

    const result = this.db
      .prepare('DELETE FROM comfyui_configs WHERE id = ?')
      .run(id)

    if (result.changes > 0 && existing.is_active) {
      const first = this.findAll()[0]
      if (first) {
        this.setActive(first.id)
      }
    }

    return result.changes > 0
  }
}
