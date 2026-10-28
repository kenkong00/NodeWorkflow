import Database from 'better-sqlite3';
import { openDb } from '../db';

export interface StylePresetItem {
  id: string;
  preset_name: string;
  category: string;
  description: string;
  config: string;
  is_system: number;
  is_enabled: number;
  created_at: number;
  updated_at: number;
}

export class StylePresetsRepo {
  private get db(): Database.Database {
    return openDb();
  }

  findAll(): StylePresetItem[] {
    return this.db.prepare('SELECT * FROM style_presets WHERE is_enabled = 1 ORDER BY category ASC, preset_name ASC').all() as StylePresetItem[];
  }

  findById(id: string): StylePresetItem | undefined {
    return this.db.prepare('SELECT * FROM style_presets WHERE id = ?').get(id) as StylePresetItem | undefined;
  }

  findByCategory(category: string): StylePresetItem[] {
    return this.db.prepare('SELECT * FROM style_presets WHERE category = ? AND is_enabled = 1 ORDER BY preset_name ASC').all(category) as StylePresetItem[];
  }

  findSystemPresets(): StylePresetItem[] {
    return this.db.prepare('SELECT * FROM style_presets WHERE is_system = 1 AND is_enabled = 1').all() as StylePresetItem[];
  }

  findUserPresets(): StylePresetItem[] {
    return this.db.prepare('SELECT * FROM style_presets WHERE is_system = 0 AND is_enabled = 1 ORDER BY created_at DESC').all() as StylePresetItem[];
  }

  getCategories(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT category FROM style_presets WHERE is_enabled = 1 ORDER BY category').all() as { category: string }[];
    return rows.map(row => row.category);
  }

  create(data: Omit<StylePresetItem, 'id' | 'created_at' | 'updated_at'>): StylePresetItem {
    const id = `style_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO style_presets (id, preset_name, category, description, config, is_system, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.preset_name,
      data.category,
      data.description,
      data.config,
      data.is_system || 0,
      data.is_enabled || 1,
      now,
      now
    );

    return this.findById(id)!;
  }

  update(id: string, data: Partial<Omit<StylePresetItem, 'id' | 'created_at'>>): StylePresetItem | null {
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

    this.db.prepare(`UPDATE style_presets SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM style_presets WHERE id = ? AND is_system = 0').run(id);
    return result.changes > 0;
  }
}

export const stylePresetsRepo = new StylePresetsRepo();
