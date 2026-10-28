import Database from 'better-sqlite3'
import type { WorkflowFolder } from '../types'
import { getDatabase } from '../db'

export class WorkflowFolderRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): WorkflowFolder[] {
    return this.db
      .prepare('SELECT * FROM workflow_folders ORDER BY sort_order ASC, created_at ASC')
      .all() as WorkflowFolder[]
  }

  findById(id: string): WorkflowFolder | undefined {
    return this.db
      .prepare('SELECT * FROM workflow_folders WHERE id = ?')
      .get(id) as WorkflowFolder | undefined
  }

  findByName(name: string): WorkflowFolder | undefined {
    return this.db
      .prepare('SELECT * FROM workflow_folders WHERE name = ?')
      .get(name) as WorkflowFolder | undefined
  }

  create(data: { name: string; sort_order?: number }): WorkflowFolder {
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const maxOrder = (
      this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_ord FROM workflow_folders').get() as { max_ord: number }
    ).max_ord

    this.db.prepare(
      'INSERT INTO workflow_folders (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, data.name, data.sort_order ?? (maxOrder + 1), now)

    return { id, name: data.name, sort_order: data.sort_order ?? (maxOrder + 1), created_at: now }
  }

  update(id: string, data: Partial<Pick<WorkflowFolder, 'name' | 'sort_order'>>): boolean {
    const sets: string[] = []
    const values: any[] = []

    if (data.name !== undefined) {
      sets.push('name = ?')
      values.push(data.name)
    }
    if (data.sort_order !== undefined) {
      sets.push('sort_order = ?')
      values.push(data.sort_order)
    }

    if (sets.length === 0) return false

    values.push(id)
    const result = this.db
      .prepare(`UPDATE workflow_folders SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)

    return result.changes > 0
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM workflow_folders WHERE id = ?').run(id)
    return result.changes > 0
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS cnt FROM workflow_folders').get() as { cnt: number }).cnt
  }
}
