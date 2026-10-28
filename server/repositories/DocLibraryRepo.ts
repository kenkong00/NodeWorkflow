import Database from 'better-sqlite3'
import { getDatabase } from '../db'

export interface DocCategoryRow {
  id: string
  name: string
  description: string
  sort_order: number
  created_at: number
  updated_at: number
}

export interface DocumentRow {
  id: string
  category_id: string
  title: string
  content: string
  created_at: number
  updated_at: number
}

export class DocCategoryRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): DocCategoryRow[] {
    return this.db
      .prepare('SELECT * FROM doc_categories ORDER BY sort_order ASC, created_at ASC')
      .all() as DocCategoryRow[]
  }

  findById(id: string): DocCategoryRow | undefined {
    return this.db
      .prepare('SELECT * FROM doc_categories WHERE id = ?')
      .get(id) as DocCategoryRow | undefined
  }

  findByName(name: string): DocCategoryRow | undefined {
    return this.db
      .prepare('SELECT * FROM doc_categories WHERE name = ?')
    .get(name) as DocCategoryRow | undefined
  }

  create(data: { name: string; description?: string; sort_order?: number }): DocCategoryRow {
    const id = `doccat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const maxOrder = (
      this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_ord FROM doc_categories').get() as { max_ord: number }
    ).max_ord

    this.db
      .prepare('INSERT INTO doc_categories (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.description || '', data.sort_order ?? (maxOrder + 1), now, now)

    return this.findById(id)!
  }

  update(id: string, data: Partial<Pick<DocCategoryRow, 'name' | 'description' | 'sort_order'>>): boolean {
    const sets: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description) }
    if (data.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(data.sort_order) }

    if (sets.length === 0) return false

    sets.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const result = this.db
      .prepare(`UPDATE doc_categories SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)

    return result.changes > 0
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM doc_categories WHERE id = ?').run(id)
    return result.changes > 0
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS cnt FROM doc_categories').get() as { cnt: number }).cnt
  }
}

export class DocumentRepo {
  private db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db || getDatabase()
  }

  findAll(): DocumentRow[] {
    return this.db
      .prepare('SELECT * FROM documents ORDER BY updated_at DESC')
      .all() as DocumentRow[]
  }

  findByCategory(categoryId: string): DocumentRow[] {
    return this.db
      .prepare('SELECT * FROM documents WHERE category_id = ? ORDER BY updated_at DESC')
      .all(categoryId) as DocumentRow[]
  }

  findById(id: string): DocumentRow | undefined {
    return this.db
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(id) as DocumentRow | undefined
  }

  create(data: { category_id: string; title: string; content?: string }): DocumentRow {
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    this.db
      .prepare('INSERT INTO documents (id, category_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.category_id, data.title, data.content || '', now, now)

    return this.findById(id)!
  }

  update(id: string, data: Partial<Pick<DocumentRow, 'category_id' | 'title' | 'content'>>): boolean {
    const sets: string[] = []
    const values: any[] = []

    if (data.category_id !== undefined) { sets.push('category_id = ?'); values.push(data.category_id) }
    if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title) }
    if (data.content !== undefined) { sets.push('content = ?'); values.push(data.content) }

    if (sets.length === 0) return false

    sets.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const result = this.db
      .prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)

    return result.changes > 0
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    return result.changes > 0
  }

  deleteByCategory(categoryId: string): boolean {
    this.db.prepare('DELETE FROM documents WHERE category_id = ?').run(categoryId)
    return true
  }
}

export class DocLibraryRepo {
  categories: DocCategoryRow[]
  documents: DocumentRow[]

  constructor() {
    this.categories = []
    this.documents = []
  }
}
