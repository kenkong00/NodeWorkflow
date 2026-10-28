import Database from 'better-sqlite3';
import { openDb } from '../db';

export interface ControlLibraryItem {
  id: string;
  control_type: string;
  display_name: string;
  category: string;
  icon: string;
  description: string;
  config_schema: string;
  default_style: string;
  is_system: number;
  is_enabled: number;
  sort_order: number;
  port_config?: string;
  style_refs?: string;
  show_label?: number;
  default_label?: string;
  created_at: number;
  updated_at: number;
}

export class ControlLibraryRepo {
  private get db(): Database.Database {
    return openDb();
  }

  findAll(): ControlLibraryItem[] {
    return this.db.prepare('SELECT * FROM control_library WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC').all() as ControlLibraryItem[];
  }

  findById(id: string): ControlLibraryItem | undefined {
    return this.db.prepare('SELECT * FROM control_library WHERE id = ?').get(id) as ControlLibraryItem | undefined;
  }

  findByType(controlType: string): ControlLibraryItem | undefined {
    return this.db.prepare('SELECT * FROM control_library WHERE control_type = ?').get(controlType) as ControlLibraryItem | undefined;
  }

  findByCategory(category: string): ControlLibraryItem[] {
    return this.db.prepare('SELECT * FROM control_library WHERE category = ? AND is_enabled = 1 ORDER BY sort_order ASC').all(category) as ControlLibraryItem[];
  }

  findSystemControls(): ControlLibraryItem[] {
    return this.db.prepare('SELECT * FROM control_library WHERE is_system = 1 AND is_enabled = 1 ORDER BY sort_order ASC').all() as ControlLibraryItem[];
  }

  findUserControls(): ControlLibraryItem[] {
    return this.db.prepare('SELECT * FROM control_library WHERE is_system = 0 AND is_enabled = 1 ORDER BY created_at DESC').all() as ControlLibraryItem[];
  }

  getCategories(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT category FROM control_library WHERE is_enabled = 1 ORDER BY category').all() as { category: string }[];
    return rows.map(row => row.category);
  }

  create(data: Omit<ControlLibraryItem, 'id' | 'created_at' | 'updated_at'>): ControlLibraryItem {
    const id = `ctrl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO control_library (id, control_type, display_name, category, icon, description, config_schema, default_style, is_system, is_enabled, sort_order, port_config, style_refs, show_label, default_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.control_type,
      data.display_name,
      data.category,
      data.icon,
      data.description,
      data.config_schema,
      data.default_style,
      data.is_system,
      data.is_enabled,
      data.sort_order,
      JSON.stringify(data.port_config || {}),
      JSON.stringify(data.style_refs || {}),
      data.show_label ?? 0,
      data.default_label || '',
      now,
      now
    );

    return this.findById(id)!;
  }

  update(id: string, data: Partial<Omit<ControlLibraryItem, 'id' | 'created_at'>>): ControlLibraryItem | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const now = Math.floor(Date.now() / 1000);
    const fields = [];
    const values: any[] = [];

    (Object.keys(data) as string[]).forEach(key => {
      if (key !== 'id' && key !== 'created_at' && (data as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push((data as any)[key]);
      }
    });

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE control_library SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id) ?? null;
  }

  delete(id: string): boolean {
    const item = this.findById(id);
    if (!item || item.is_system === 1) return false;

    const controlType = item.control_type;

    const tables = ['node_control_instances', 'node_control_instances_v2'];
    for (const table of tables) {
      try {
        this.db.prepare(`DELETE FROM ${table} WHERE control_type = ?`).run(controlType);
      } catch {
        // 表可能不存在，忽略错误
      }
    }

    const result = this.db.prepare('DELETE FROM control_library WHERE id = ? AND is_system = 0').run(id);
    return result.changes > 0;
  }

  duplicate(sourceId: string, newDisplayName?: string): ControlLibraryItem | null {
    const source = this.findById(sourceId);
    if (!source) return null;

    const uniqueType = `${source.control_type}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    return this.create({
      control_type: uniqueType,
      display_name: newDisplayName || `${source.display_name} (副本)`,
      category: source.category,
      icon: source.icon,
      description: source.description,
      config_schema: source.config_schema,
      default_style: source.default_style,
      is_system: 0,
      is_enabled: 1,
      sort_order: source.sort_order + 1
    });
  }
}

export const controlLibraryRepo = new ControlLibraryRepo();
