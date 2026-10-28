import Database from 'better-sqlite3'
import type { TestedModel } from '../types'
import { getDatabase } from '../db'

export interface TestedModelRecord {
  id: string
  provider_type: string
  model_id: string
  model_name: string
  tested_at: number
  created_at: number
}

export class TestedModelsRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): Record<string, TestedModel[]> {
    const rows = this.db
      .prepare('SELECT * FROM tested_models ORDER BY tested_at DESC')
      .all() as TestedModelRecord[]

    const result: Record<string, TestedModel[]> = {}
    for (const row of rows) {
      if (!result[row.provider_type]) {
        result[row.provider_type] = []
      }
      result[row.provider_type].push({
        id: row.model_id,
        name: row.model_name,
        testedAt: new Date(row.tested_at).toISOString()
      })
    }
    return result
  }

  findByProvider(providerType: string): TestedModel[] {
    const rows = this.db
      .prepare('SELECT * FROM tested_models WHERE provider_type = ? ORDER BY tested_at DESC')
      .all(providerType) as TestedModelRecord[]

    return rows.map(row => ({
      id: row.model_id,
      name: row.model_name,
      testedAt: new Date(row.tested_at).toISOString()
    }))
  }

  create(data: {
    provider_type: string
    model_id: string
    model_name: string
    testedAt: number
  }): TestedModelRecord {
    const id = `tm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO tested_models (id, provider_type, model_id, model_name, tested_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, data.provider_type, data.model_id, data.model_name, data.testedAt, now)

    return {
      id,
      provider_type: data.provider_type,
      model_id: data.model_id,
      model_name: data.model_name,
      tested_at: data.testedAt,
      created_at: now
    }
  }

  upsert(providerType: string, modelId: string, modelName: string): TestedModelRecord | null {
    const existing = this.db
      .prepare('SELECT * FROM tested_models WHERE provider_type = ? AND model_id = ?')
      .get(providerType, modelId) as TestedModelRecord | undefined

    if (existing) {
      const now = Date.now()
      this.db
        .prepare('UPDATE tested_models SET model_name = ?, tested_at = ? WHERE id = ?')
        .run(modelName, now, existing.id)
      return { ...existing, model_name: modelName, tested_at: now }
    }

    return this.create({
      provider_type: providerType,
      model_id: modelId,
      model_name: modelName,
      testedAt: Date.now()
    })
  }

  delete(providerType: string, modelId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM tested_models WHERE provider_type = ? AND model_id = ?')
      .run(providerType, modelId)
    return result.changes > 0
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM tested_models').run()
  }

  replaceAll(data: Record<string, TestedModel[]>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM tested_models').run()

      for (const [provider, models] of Object.entries(data)) {
        for (const model of models) {
          this.create({
            provider_type: provider,
            model_id: model.id,
            model_name: model.name,
            testedAt: new Date(model.testedAt).getTime()
          })
        }
      }
    })

    tx()
  }
}
