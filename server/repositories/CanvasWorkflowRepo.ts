import Database from 'better-sqlite3'
import type { CanvasWorkflow } from '../types'
import { getDatabase } from '../db'

export class CanvasWorkflowRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): CanvasWorkflow[] {
    return this.db
      .prepare('SELECT * FROM canvas_workflows ORDER BY updated_at DESC')
      .all() as CanvasWorkflow[]
  }

  findById(id: string): CanvasWorkflow | undefined {
    return this.db
      .prepare('SELECT * FROM canvas_workflows WHERE id = ?')
      .get(id) as CanvasWorkflow | undefined
  }

  create(data: Omit<CanvasWorkflow, 'id' | 'created_at' | 'updated_at'>): CanvasWorkflow {
    const id = `canvas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO canvas_workflows (id, name, description, node_data, edge_data, viewport_x, viewport_y, viewport_zoom, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.name || '未命名工作流',
        data.description || '',
        typeof data.node_data === 'object' ? JSON.stringify(data.node_data) : (data.node_data || '[]'),
        typeof data.edge_data === 'object' ? JSON.stringify(data.edge_data) : (data.edge_data || '[]'),
        data.viewport_x ?? 0,
        data.viewport_y ?? 0,
        data.viewport_zoom ?? 1,
        data.is_favorite ? 1 : 0,
        now,
        now
      )

    return this.findById(id)!
  }

  update(id: string, data: Partial<CanvasWorkflow>): CanvasWorkflow | null {
    const existing = this.findById(id)
    if (!existing) return null

    const fields: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.node_data !== undefined) {
      fields.push('node_data = ?')
      values.push(typeof data.node_data === 'object' ? JSON.stringify(data.node_data) : data.node_data)
    }
    if (data.edge_data !== undefined) {
      fields.push('edge_data = ?')
      values.push(typeof data.edge_data === 'object' ? JSON.stringify(data.edge_data) : data.edge_data)
    }
    if (data.viewport_x !== undefined) { fields.push('viewport_x = ?'); values.push(data.viewport_x) }
    if (data.viewport_y !== undefined) { fields.push('viewport_y = ?'); values.push(data.viewport_y) }
    if (data.viewport_zoom !== undefined) { fields.push('viewport_zoom = ?'); values.push(data.viewport_zoom) }
    if (data.is_favorite !== undefined) { fields.push('is_favorite = ?'); values.push(data.is_favorite ? 1 : 0) }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db
      .prepare(`UPDATE canvas_workflows SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    return this.findById(id) ?? null
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM canvas_workflows WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  toggleFavorite(id: string): CanvasWorkflow | null {
    const existing = this.findById(id)
    if (!existing) return null

    return this.update(id, { is_favorite: existing.is_favorite ? 0 : 1 })
  }
}
