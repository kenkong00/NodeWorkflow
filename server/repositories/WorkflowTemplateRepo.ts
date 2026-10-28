import Database from 'better-sqlite3'
import type { WorkflowTemplate } from '../types'
import { getDatabase } from '../db'

export class WorkflowTemplateRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): WorkflowTemplate[] {
    return this.db
      .prepare('SELECT * FROM workflow_templates ORDER BY updated_at DESC')
      .all() as WorkflowTemplate[]
  }

  findById(id: string): WorkflowTemplate | undefined {
    return this.db
      .prepare('SELECT * FROM workflow_templates WHERE id = ?')
      .get(id) as WorkflowTemplate | undefined
  }

  create(data: Omit<WorkflowTemplate, 'id' | 'created_at' | 'updated_at'>): WorkflowTemplate {
    const id = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO workflow_templates (id, name, description, content, category, tags, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.name,
        data.description || '',
        typeof data.content === 'object' ? JSON.stringify(data.content) : data.content,
        data.category || '未分类',
        typeof data.tags === 'object' ? JSON.stringify(data.tags) : (data.tags || '[]'),
        data.version || 1,
        now,
        now
      )

    return this.findById(id)!
  }

  update(id: string, data: Partial<WorkflowTemplate>): WorkflowTemplate | null {
    const existing = this.findById(id)
    if (!existing) return null

    const fields: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.content !== undefined) {
      fields.push('content = ?')
      values.push(typeof data.content === 'object' ? JSON.stringify(data.content) : data.content)
    }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
    if (data.tags !== undefined) {
      fields.push('tags = ?')
      values.push(typeof data.tags === 'object' ? JSON.stringify(data.tags) : data.tags)
    }
    if (data.version !== undefined) { fields.push('version = ?'); values.push(data.version) }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    this.db
      .prepare(`UPDATE workflow_templates SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    return this.findById(id) ?? null
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM workflow_templates WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
