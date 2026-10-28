import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.resolve(__dirname, '../data/platform.db')
const INIT_SQL_PATH = path.resolve(__dirname, './init.sql')

let dbInstance: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance
  }

  const dbDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = new Database(DB_PATH)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initDatabase(db)

  dbInstance = db
  return db
}

export const openDb = getDatabase

export function initDatabase(db: Database.Database): void {
  if (fs.existsSync(INIT_SQL_PATH)) {
    const sql = fs.readFileSync(INIT_SQL_PATH, 'utf-8')
    db.exec(sql)
    console.log('[DB] ✅ 数据库表初始化完成')
  }

  migrateOldData(db)
  migrateControlColumns(db)
  purgeAllCustomNodes(db)
  seedDocLibrary(db)
}

/**
 * 彻底清除所有自定义节点记录
 * 项目已移除「自定义节点」功能，数据库里的残留数据全部清理，
 * 避免节点库/配置区的自定义节点无法删除。
 */
function purgeAllCustomNodes(db: Database.Database): void {
  const tables = [
    'node_control_instances_v2',
    'nodes',
    'node_published_control_instances',
    'node_published',
    'node_draft_control_instances',
    'node_drafts',
    'node_control_instances',
    'custom_nodes'
  ]

  const dropped: string[] = []
  for (const table of tables) {
    try {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
      if (!exists) continue
      // 直接删表：既清除数据，也清除表结构，确保自定义节点彻底不残留
      db.exec(`DROP TABLE IF EXISTS ${table}`)
      dropped.push(table)
    } catch (err: any) {
      console.warn(`[Purge] ⚠️ 删除表 ${table} 失败:`, err?.message || err)
    }
  }

  if (dropped.length > 0) {
    console.log(`[Purge] 🗑️ 已删除自定义节点相关表: ${dropped.join(', ')}`)
  }
}

function migrateOldData(db: Database.Database): void {
  const oldWorkflowPath = path.resolve(__dirname, '../public/workflow-api.json')

  if (fs.existsSync(oldWorkflowPath)) {
    try {
      const raw = fs.readFileSync(oldWorkflowPath, 'utf-8')
      const oldData = JSON.parse(raw)

      if (oldData.id && oldData.name && oldData.content) {
        const exists = db.prepare(
          'SELECT id FROM workflow_templates WHERE id = ?'
        ).get(oldData.id)

        if (!exists) {
          db.prepare(`
            INSERT INTO workflow_templates (id, name, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            oldData.id,
            oldData.name,
            typeof oldData.content === 'string'
              ? oldData.content
              : JSON.stringify(oldData.content),
            oldData.createdAt || Date.now(),
            oldData.updatedAt || Date.now()
          )

          console.log(`[Migration] ✅ 已迁移旧工作流: ${oldData.name}`)
        }
      }
    } catch (err) {
      console.warn('[Migration] ⚠️ 迁移旧工作流数据失败:', err)
    }
  }

  const oldConfigPath = path.resolve(__dirname, '../public/comfyui-config.json')

  if (fs.existsSync(oldConfigPath)) {
    try {
      const raw = fs.readFileSync(oldConfigPath, 'utf-8')
      const oldConfig = JSON.parse(raw)

      if (oldConfig.url) {
        const count = db.prepare(
          'SELECT COUNT(*) as count FROM comfyui_configs'
        ).get() as { count: number }

        if (count.count === 0) {
          const id = `config-${Date.now()}`
          db.prepare(`
            INSERT INTO comfyui_configs (id, name, url, timeout, auto_connect, is_active, created_at, updated_at)
            VALUES (?, '默认配置', ?, ?, ?, 1, ?, ?)
          `).run(
            id,
            oldConfig.url,
            oldConfig.timeout || 30000,
            oldConfig.autoConnect ? 1 : 0,
            Date.now(),
            Date.now()
          )

          console.log(`[Migration] ✅ 已迁移旧 ComfyUI 配置`)
        }
      }
    } catch (err) {
      console.warn('[Migration] ⚠️ 迁移旧配置数据失败:', err)
    }
  }
}

function migrateControlColumns(db: Database.Database): void {
  const addColumn = (table: string, col: string, type: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
      console.log(`[Migration] ✅ 已添加列 ${table}.${col}`)
    } catch (err: any) {
      if (!err.message?.includes('duplicate column name')) {
        console.warn(`[Migration] ⚠️ 添加列 ${table}.${col} 失败:`, err.message)
      }
    }
  }

  addColumn('node_control_instances', 'has_input_port', 'INTEGER DEFAULT 1')
  addColumn('node_control_instances', 'input_port_data_type', "TEXT DEFAULT 'ANY'")
  addColumn('node_control_instances', 'input_port_name', "TEXT DEFAULT ''")
  addColumn('node_control_instances', 'show_label', 'INTEGER DEFAULT 0')
  addColumn('node_control_instances', 'port_style_id', "TEXT DEFAULT ''")

  addColumn('control_library', 'port_config', "TEXT DEFAULT '{}'")
  addColumn('control_library', 'style_refs', "TEXT DEFAULT '{}'")
  addColumn('control_library', 'show_label', 'INTEGER DEFAULT 0')
  addColumn('control_library', 'default_label', "TEXT DEFAULT ''")
}

/**
 * 文档库种子数据
 * 首次启动（分类表为空）时写入默认分类与示例提示词规则，
 * 方便直接在「文本输入」节点里载入测试。
 */
function seedDocLibrary(db: Database.Database): void {
  try {
    const count = (db.prepare('SELECT COUNT(*) AS cnt FROM doc_categories').get() as { cnt: number }).cnt
    if (count > 0) return

    const now = Date.now()
    const seed: Array<{ name: string; description: string; docs: Array<{ title: string; content: string }> }> = [
      {
        name: '提示词规则',
        description: '配合 API 服务商节点使用的通用规则',
        docs: [
          {
            title: '通用润色规则',
            content: [
              '你是一名资深中文编辑。请按以下规则处理用户给出的文本：',
              '1. 保持原文事实与观点，不得编造或删减关键信息；',
              '2. 修正错别字、语病与不通顺的表达；',
              '3. 统一标点为全角中文标点；',
              '4. 长句适当拆分，提升可读性；',
              '5. 输出只保留处理后的正文，不要解释你的改动。'
            ].join('\n')
          },
          {
            title: '摘要提取规则',
            content: [
              '请为下面的文本生成摘要，遵循：',
              '1. 长度控制在 200 字以内；',
              '2. 采用「总—分」结构：先一句总结，再列 3 条要点；',
              '3. 要点使用「- 」开头，每条不超过 40 字；',
              '4. 不引入原文之外的信息。'
            ].join('\n')
          },
          {
            title: '翻译规则（中英互译）',
              content: [
              '你是一名专业译员，请按以下规则翻译：',
              '1. 若原文为中文则译为英文，若为英文则译为中文；',
              '2. 术语保持前后一致，专有名词保留原文并附中文译名；',
              '3. 语气贴合原文风格，不随意扩写或省略；',
              '4. 只输出译文，不要附加说明。'
            ].join('\n')
          },
          {
            title: '结构化整理规则',
            content: [
              '请把下面的内容整理为结构化格式：',
              '1. 使用 Markdown；',
              '2. 一级标题概括主题，二级标题划分主题块；',
              '3. 并列信息用无序列表，流程步骤用有序列表；',
              '4. 关键数据用加粗标注。'
            ].join('\n')
          }
        ]
      },
      {
        name: '角色设定',
        description: '用于聊天节点的角色/语气设定',
        docs: [
          {
            title: '严谨技术顾问',
            content: [
              '你是一名严谨的技术顾问。回答要求：',
              '- 结论先行，再给依据；',
              '- 涉及数据必须标明来源或推算方式；',
              '- 不确定的部分明确说明「不确定」，不做臆测；',
              '- 优先给出可执行的步骤。'
            ].join('\n')
          }
        ]
      },
      {
        name: '临时草稿',
        description: '随意存放的临时内容',
        docs: []
      }
    ]

    const insertCategory = db.prepare(
      'INSERT INTO doc_categories (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insertDoc = db.prepare(
      'INSERT INTO documents (id, category_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )

    seed.forEach((cat, idx) => {
      const catId = `doccat_${idx + 1}_${Date.now().toString(36)}`
      insertCategory.run(catId, cat.name, cat.description, idx, now, now)
      cat.docs.forEach((d, di) => {
        const docId = `doc_${idx + 1}_${di + 1}_${Date.now().toString(36)}`
        insertDoc.run(docId, catId, d.title, d.content, now, now)
      })
    })

    console.log(`[Seed] ✅ 文档库种子数据已写入 (${seed.length} 个分类)`)
  } catch (err) {
    console.warn('[Seed] ⚠️ 文档库种子数据写入失败:', err)
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
