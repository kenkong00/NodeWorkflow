import Database from 'better-sqlite3'
import type { LLMProvider } from '../types'
import { getDatabase } from '../db'

export class LLMProviderRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): LLMProvider[] {
    return this.db
      .prepare('SELECT * FROM llm_providers ORDER BY created_at ASC')
      .all() as LLMProvider[]
  }

  findById(id: string): LLMProvider | undefined {
    return this.db
      .prepare('SELECT * FROM llm_providers WHERE id = ?')
      .get(id) as LLMProvider | undefined
  }

  create(data: Omit<LLMProvider, 'id' | 'created_at' | 'updated_at'>): LLMProvider {
    const id = `llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO llm_providers (id, provider_type, name, api_key, base_url, default_model, temperature, max_tokens, enabled, extra_config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.provider_type,
        data.name,
        data.api_key || '',
        data.base_url || '',
        data.default_model || '',
        data.temperature ?? 0.7,
        data.max_tokens || 4096,
        data.enabled ? 1 : 0,
        typeof data.extra_config === 'object' ? JSON.stringify(data.extra_config) : (data.extra_config || '{}'),
        now,
        now
      )

    return this.findById(id)!
  }

  update(id: string, data: Partial<LLMProvider>): LLMProvider | null {
    const existing = this.findById(id)
    if (!existing) return null

    const fields: string[] = []
    const values: any[] = []

    if (data.provider_type !== undefined) { fields.push('provider_type = ?'); values.push(data.provider_type) }
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.api_key !== undefined) { fields.push('api_key = ?'); values.push(data.api_key) }
    if (data.base_url !== undefined) { fields.push('base_url = ?'); values.push(data.base_url) }
    if (data.default_model !== undefined) { fields.push('default_model = ?'); values.push(data.default_model) }
    if (data.temperature !== undefined) { fields.push('temperature = ?'); values.push(data.temperature) }
    if (data.max_tokens !== undefined) { fields.push('max_tokens = ?'); values.push(data.max_tokens) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }
    if (data.extra_config !== undefined) {
      fields.push('extra_config = ?')
      values.push(typeof data.extra_config === 'object' ? JSON.stringify(data.extra_config) : data.extra_config)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db
      .prepare(`UPDATE llm_providers SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    return this.findById(id) ?? null
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM llm_providers WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
