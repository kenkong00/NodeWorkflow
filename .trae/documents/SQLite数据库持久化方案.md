# 全面数据持久化方案 - SQLite 数据库

## 📊 当前问题全景分析

### 现状：JSON 文件存储（有严重缺陷）

**当前架构** (vite.config.ts):
```
Vite Dev Server 中间件
    ↓
/api/config      → public/comfyui-config.json  (单文件, 1个配置)
/api/workflow    → public/workflow-api.json     (单文件, 1个工作流!)
```

### 需要持久化的数据清单

| # | 功能区域 | 数据类型 | 当前状态 | 问题 |
|---|---------|---------|---------|------|
| 1 | **工作台** | 画布工作流（节点+连线） | 导出为文件下载 | ❌ 无系统级保存 |
| 2 | **配置中心** | ComfyUI 服务器配置 | 单个 JSON 文件 | ❌ 只能存1个 |
| 3 | **工具区** | 工作流 API 模板 | 单个 JSON 文件 | ❌ 只能存1个，刷新丢失 |
| 4 | **配置中心** | 大模型 API 配置 | localStorage | ❌ 用户已拒绝此方案 |
| 5 | **未来** | 节点包配置 | 未实现 | ⏳ 待开发 |

---

## 🎯 推荐方案: SQLite + Repository 模式

### 为什么选择 SQLite？

| 特性 | SQLite | PostgreSQL | MySQL | localStorage | JSON文件 |
|------|--------|-----------|-------|-------------|----------|
| **真正的数据库** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **无需安装服务** | ✅ | ❌ | ❌ | ✅ | ✅ |
| **SQL查询能力** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **事务支持(ACID)** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **跨浏览器同步** | ✅* | ✅ | ✅ | ❌ | ❌ |
| **并发安全** | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| **数据量限制** | ~140TB | 无限 | 无限 | 5MB | 无硬限制 |
| **部署复杂度** | 极低 | 高 | 高 | 无 | 无 |
| **未来迁移难度** | 低 | - | - | 高 | 高 |

> *注: SQLite 是服务端存储，天然跨浏览器（所有客户端连同一服务器）

**结论**: SQLite 完美平衡了"真正的数据库能力"和"零配置部署"，且为未来迁移到 PostgreSQL 打好基础。

---

## 🏗️ 技术架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                   前端 (Vue 3)                       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 工作台    │  │ 工具区    │  │ 配置中心  │         │
│  │ Workspace │  │ Tools    │  │ Settings │         │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘         │
│        │             │             │               │
│        ▼             ▼             ▼               │
│  ┌─────────────────────────────────────┐           │
│  │          Pinia Stores              │           │
│  │  workflowStore / configStore / ... │           │
│  └──────────────┬──────────────────────┘           │
│                 │ HTTP (fetch)                     │
└─────────────────┼───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│              Vite Server Middleware                  │
│                                                     │
│  ┌─────────────────────────────────────┐           │
│  │       RESTful API Routes            │           │
│  │                                     │           │
│  │  GET/POST /api/workflows            │           │
│  │  GET/POST /api/workflows/:id        │           │
│  │  DELETE  /api/workflows/:id         │           │
│  │                                     │           │
│  │  GET/POST /api/comfyui-configs      │           │
│  │  PUT/DELETE /api/comfyui-configs/:id│           │
│  │                                     │           │
│  │  GET/POST /api/llm-providers        │           │
│  │  PUT/DELETE /api/llm-providers/:id  │           │
│  │                                     │           │
│  │  GET/POST /api/canvas-workflows     │           │
│  │  (工作台的画布数据)                  │           │
│  └──────────────┬──────────────────────┘           │
│                 │                                   │
│                 ▼                                   │
│  ┌─────────────────────────────────────┐           │
│  │     Repository Layer (DAO)          │           │
│  │                                     │           │
│  │  WorkflowRepository                 │           │
│  │  ComfyUIConfigRepository            │           │
│  │  LLMProviderRepository              │           │
│  │  CanvasWorkflowRepository           │           │
│  └──────────────┬──────────────────────┘           │
│                 │                                   │
│                 ▼                                   │
│  ┌─────────────────────────────────────┐           │
│  │         SQLite Database             │           │
│  │     data/platform.db                │           │
│  └─────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

---

## 💾 数据库 Schema 设计

### ER 图（实体关系）

```
┌──────────────────┐       ┌──────────────────────┐
│   canvas_workflows│       │  workflow_templates  │
├──────────────────┤       ├──────────────────────┤
│ id (PK)          │       │ id (PK)              │
│ name             │       │ name                 │
│ description      │       │ description          │
│ node_data (JSON) │       │ content (JSON)       │
│ edge_data (JSON) │       │ category             │
│ created_at       │       │ created_at           │
│ updated_at       │       │ updated_at           │
│ is_favorite      │       │ tags (JSON)          │
└──────────────────┘       └──────────────────────┘
         ↑                          ↑
         │                          │
    工作台使用                  工具区使用

┌──────────────────┐       ┌──────────────────────┐
│ comfyui_configs  │       │   llm_providers      │
├──────────────────┤       ├──────────────────────┤
│ id (PK)          │       │ id (PK)              │
│ name             │       │ provider_type        │
│ url              │       │ name                 │
│ timeout          │       │ api_key (加密?)      │
│ auto_connect     │       │ base_url             │
│ is_active        │       │ default_model        │
│ created_at       │       │ temperature          │
│ updated_at       │       │ max_tokens           │
└──────────────────┘       │ enabled              │
                           │ extra_config (JSON)  │
                           │ created_at           │
                           │ updated_at           │
                           └──────────────────────┘
```

### SQL 建表语句

```sql
-- ============================================
-- 表1: 画布工作流（工作台使用）
-- 存储用户在画布上创建的工作流节点和连线数据
-- ============================================
CREATE TABLE IF NOT EXISTS canvas_workflows (
  id TEXT PRIMARY KEY,                    -- UUID
  name TEXT NOT NULL DEFAULT '未命名工作流',
  description TEXT DEFAULT '',
  node_data TEXT NOT NULL DEFAULT '[]',  -- JSON: 节点数组
  edge_data TEXT NOT NULL DEFAULT '[]',  -- JSON: 连线数组
  viewport_x REAL DEFAULT 0,
  viewport_y REAL DEFAULT 0,
  viewport_zoom REAL DEFAULT 1,
  is_favorite BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL             -- Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_canvas_updated ON canvas_workflows(updated_at);
CREATE INDEX IF NOT EXISTS idx_canvas_fav ON canvas_workflows(is_favorite);

-- ============================================
-- 表2: 工作流模板（工具区使用）
-- 存储 ComfyUI API 格式的工作流模板
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_templates (
  id TEXT PRIMARY KEY,                    -- UUID
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '{}',    -- JSON: ComfyUI workflow format
  category TEXT DEFAULT '未分类',
  tags TEXT DEFAULT '[]',                -- JSON: 标签数组
  version INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wf_category ON workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_wf_updated ON workflow_templates(updated_at);

-- ============================================
-- 表3: ComfyUI 配置（配置中心使用）
-- 支持多个 ComfyUI 服务器配置
-- ============================================
CREATE TABLE IF NOT EXISTS comfyui_configs (
  id TEXT PRIMARY KEY,                    -- UUID
  name TEXT NOT NULL DEFAULT '默认配置',
  url TEXT NOT NULL,
  timeout INTEGER DEFAULT 30000,
  auto_connect BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 0,            -- 是否为当前活动配置
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 确保只有一个活动配置
CREATE UNIQUE INDEX IF NOT EXISTS idx_comfyui_active ON comfyui_configs(is_active)
  WHERE is_active = 1;

-- ============================================
-- 表4: 大模型 API 提供商配置（配置中心使用）
-- ============================================
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,                    -- UUID
  provider_type TEXT NOT NULL,            -- 'openai' | 'claude' | 'gemini' | 'custom'
  name TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',       -- TODO: 后续考虑加密存储
  base_url TEXT DEFAULT '',
  default_model TEXT DEFAULT '',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 4096,
  enabled BOOLEAN DEFAULT 1,
  extra_config TEXT DEFAULT '{}',         -- JSON: 其他自定义参数
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_type ON llm_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_llm_enabled ON llm_providers(enabled);
```

---

## 🔧 实施步骤

### 阶段1: 基础设施搭建（核心）

#### 步骤1.1: 安装 SQLite 依赖
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

**为什么选 `better-sqlite3`?**
- 同步 API，简单易用
- 性能优秀
- TypeScript 支持好
- 活跃维护

#### 步骤1.2: 创建数据库初始化模块
**新建文件**: `server/db.ts`

```typescript
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.resolve(__dirname, '../data/platform.db')

export function getDatabase(): Database.Database {
  // 确保 data 目录存在
  const dbDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = new Database(DB_PATH)

  // 启用 WAL 模式（更好的并发性能）
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return db
}

export function initDatabase(db: Database.Database): void {
  // 执行上面的建表 SQL...
}
```

#### 步骤1.3: 创建 Repository 层（数据访问对象）
**新建目录**: `server/repositories/`

每个实体一个 Repository 文件:

```
server/
├── db.ts                          # 数据库连接和初始化
├── init.sql                       # 建表语句
└── repositories/
    ├── WorkflowTemplateRepo.ts    # 工作流模板 CRUD
    ├── CanvasWorkflowRepo.ts      # 画布工作流 CRUD
    ├── ComfyUIConfigRepo.ts       # ComfyUI配置 CRUD
    └── LLMProviderRepo.ts         # LLM提供商 CRUD
```

**Repository 接口示例**:
```typescript
// server/repositories/BaseRepository.ts
interface IRepository<T> {
  findAll(): T[]
  findById(id: string): T | undefined
  create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): T
  update(id: string, data: Partial<T>): T | null
  delete(id: string): boolean
}

// server/repositories/CanvasWorkflowRepo.ts
import type { CanvasWorkflow } from '../types'
import { getDatabase } from '../db'

export class CanvasWorkflowRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  findAll(): CanvasWorkflow[] {
    return this.db.prepare('SELECT * FROM canvas_workflows ORDER BY updated_at DESC').all() as CanvasWorkflow[]
  }

  // ... 其他方法
}
```

### 阶段2: API 路由改造

#### 步骤2.1: 重构 vite.config.ts 的中间件

将当前的简单 JSON 读写改为调用 Repository：

```typescript
// vite.config.ts (新版本)
import { initDatabase } from './server/db'
import { CanvasWorkflowRepo } from './server/repositories/CanvasWorkflowRepo'
// ...

configureServer(server) {
  // 初始化数据库
  const db = initDatabase()
  const canvasRepo = new CanvasWorkflowRepo(db)

  // ====== 画布工作流 API ======
  server.middlewares.use('/api/canvas-workflows', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET') {
      const workflows = canvasRepo.findAll()
      res.end(JSON.stringify(workflows))
    }
    else if (req.method === 'POST') {
      // 解析 body → canvasRepo.create(data)
    }
    // ... PUT, DELETE
  })

  // ====== 工作流模板 API ======
  server.middlewares.use('/api/workflow-templates', async (req, res) => {
    // 类似结构，使用 WorkflowTemplateRepo
  })

  // ====== ComfyUI 配置 API ======
  server.middlewares.use('/api/comfyui-configs', async (req, res) => {
    // 使用 ComfyUIConfigRepo，支持多配置
  })

  // ====== LLM 提供商 API ======
  server.middlewares.use('/api/llm-providers', async (req, res) => {
    // 使用 LLMProviderRepo
  })
}
```

#### 步骤2.2: 新增 API 端点列表

| 方法 | 端点 | 说明 | 对应功能 |
|------|------|------|---------|
| GET | `/api/canvas-workflows` | 获取所有画布工作流 | 工作台-打开列表 |
| POST | `/api/canvas-workflows` | 新建画布工作流 | 工作台-保存 |
| PUT | `/api/canvas-workflows/:id` | 更新画布工作流 | 工作台-自动保存 |
| DELETE | `/api/canvas-workflows/:id` | 删除画布工作流 | 工作台-删除 |
| GET | `/api/workflow-templates` | 获取所有模板 | 工具区-列表 |
| POST | `/api/workflow-templates` | 新建模板 | 工具区-新建 |
| PUT | `/api/workflow-templates/:id` | 更新模板 | 工具区-编辑 |
| DELETE | `/api/workflow-templates/:id` | 删除模板 | 工具区-删除 |
| GET | `/api/comfyui-configs` | 获取所有配置 | 配置中心-列表 |
| POST | `/api/comfyui-configs` | 新建配置 | 配置中心-新建 |
| PUT | `/api/comfyui-configs/:id` | 更新配置 | 配置中心-编辑 |
| PUT | `/api/comfyui-configs/:id/activate` | 设为活动配置 | 配置中心-切换 |
| DELETE | `/api/comfyui-configs/:id` | 删除配置 | 配置中心-删除 |
| GET | `/api/llm-providers` | 获取所有提供商 | 配置中心-列表 |
| POST | `/api/llm-providers` | 新建提供商 | 配置中心-新建 |
| PUT | `/api/llm-providers/:id` | 更新提供商 | 配置中心-编辑 |
| DELETE | `/api/llm-providers/:id` | 删除提供商 | 配置中心-删除 |

### 阶段3: 前端 Store 改造

#### 步骤3.1: 重构 Pinia Stores

**当前**: 直接调用 `/api/workflow` (单工作流)
**目标**: 调用新的 RESTful API (多记录)

```typescript
// stores/canvasWorkflows.ts (新建)
export const useCanvasWorkflowStore = defineStore('canvasWorkflows', () => {
  const workflows = ref<CanvasWorkflow[]>([])
  const activeId = ref<string | null>(null)

  async function loadAll() {
    const res = await fetch('/api/canvas-workflows')
    workflows.value = await res.json()
  }

  async function save(workflow: Partial<CanvasWorkflow>) {
    const res = await fetch('/api/canvas-workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow)
    })
    return await res.json()
  }

  // ... update, delete, setActive
})
```

#### 步骤3.2: 更新前端组件调用

**WorkflowEditor.vue**:
```typescript
// 旧代码:
const loadWorkflows = async () => {
  await store.loadWorkflow()  // 单工作流
  if (store.workflow) {
    workflows.value = [store.workflow]
  }
}

// 新代码:
const loadWorkflows = async () => {
  const res = await fetch('/api/workflow-templates')
  workflows.value = await res.json()  // 多工作流！
}
```

**ComfyUIConfigManager.vue**:
```typescript
// 旧代码: store.config (单个)
// 新代码: fetch('/api/comfyui-configs') (多个)
```

**LLMAPIConfig.vue**:
```typescript
// 旧代码: localStorage
// 新代码: fetch('/api/llm-providers') (真正持久化)
```

### 阶段4: 清理旧代码

- [ ] 删除 `public/workflow-api.json` (不再需要)
- [ ] 删除 `public/comfyui-config.json` (迁移到数据库后)
- [ ] 清理 vite.config.ts 中的旧中间件代码
- [ ] 更新 `comfyui.ts` store（简化或移除单工作流逻辑）

---

## 📁 最终项目结构

```
g:/AI code/trae/节点编辑工作流 v0.1/
├── data/                           # 🆕 数据目录
│   └── platform.db                # SQLite 数据库文件
├── server/                         # 🆕 服务端代码
│   ├── db.ts                      # 数据库初始化
│   ├── init.sql                   # 建表语句
│   ├── types.ts                   # 服务端类型定义
│   └── repositories/
│       ├── BaseRepository.ts      # 基础 Repository
│       ├── CanvasWorkflowRepo.ts  # 画布工作流
│       ├── WorkflowTemplateRepo.ts # 工作流模板
│       ├── ComfyUIConfigRepo.ts   # ComfyUI配置
│       └── LLMProviderRepo.ts     # LLM提供商
├── src/
│   ├── stores/
│   │   ├── app.ts                 # (保持不变)
│   │   ├── comfyui.ts             # 🔄 重构: 移除单工作流逻辑
│   │   └── canvasWorkflows.ts     # 🆕 画布工作流 store
│   ├── components/
│   │   ├── layout/MainLayout.vue  # (已完成)
│   │   ├── tabs/
│   │   │   ├── WorkspaceTab.vue   # 🔄 改造: 使用新API
│   │   │   ├── ToolsTab.vue       # (已完成)
│   │   │   └── SettingsTab.vue    # (已完成)
│   │   ├── tools/
│   │   │   ├── NodeLibraryManager.vue
│   │   │   └── WorkflowEditor.vue  # 🔄 改造: 使用新API
│   │   └── settings/
│   │       ├── ComfyUIConfigManager.vue  # 🔄 改造: 使用新API
│   │       └── LLMAPIConfig.vue          # 🔄 改造: 使用新API
│   └── ...
├── public/
│   └── workflow-api.json          # 🗑️ 可删除（迁移后）
├── vite.config.ts                 # 🔄 重构: 新API路由
├── package.json                   # 🔄 添加 better-sqlite3
└── tailwind.config.js
```

---

## ⚠️ 重要注意事项

### 1. 数据迁移策略
首次启动时，自动检测旧 JSON 文件并导入到数据库：
```typescript
function migrateOldData(db: Database.Database) {
  // 检查旧文件是否存在
  const oldWorkflowPath = path.join(__dirname, '../public/workflow-api.json')
  if (fs.existsSync(oldWorkflowPath)) {
    const oldData = JSON.parse(fs.readFileSync(oldWorkflowPath, 'utf-8'))
    // 插入到 workflow_templates 表
    db.prepare(`
      INSERT OR IGNORE INTO workflow_templates (id, name, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(oldData.id, oldData.name, JSON.stringify(oldData.content),
          oldData.createdAt, oldData.updatedAt)
    
    console.log('[Migration] ✅ 已迁移旧工作流数据')
    // 可选: 备份原文件后删除
  }
}
```

### 2. API Key 安全性
当前阶段 API Key 明文存储在数据库中是可接受的（本地应用），但建议：
- 在 UI 上始终隐藏显示（已有 ✓/× 按钮）
- 未来可考虑加密存储（AES-256）
- 或使用系统密钥链（keytar）

### 3. 并发控制
SQLite 的 WAL 模式支持并发读取，但写入是串行的。
对于单用户桌面应用来说**完全够用**。

### 4. 数据库备份
可以添加一个备份按钮，复制 `data/platform.db` 文件即可完成备份。

---

## 🚀 实施优先级建议

### P0 - 立即修复（解决用户痛点）
1. ✅ 安装 better-sqlite3
2. ✅ 创建数据库和建表
3. ✅ 实现 workflow_templates 的 CRUD
4. ✅ 改造 WorkflowEditor.vue
5. ✅ **验证**: 新建多个工作流 → 刷新 → 全部保留

### P1 - 短期完善（1-2天）
6. 实现 comfyui_configs 的多配置 CRUD
7. 改造 ComfyUIConfigManager.vue
8. 实现 llm_providers 的 CRUD
9. 改造 LLMAPIConfig.vue（移除 localStorage）

### P2 - 中期优化（后续迭代）
10. 实现 canvas_workflows 的 CRUD
11. 改造工作台的保存/打开功能
12. 添加数据导出/导入功能
13. 添加数据库备份/恢复功能

---

## ❓ 需要确认的问题

在开始实施前，需要确认：

1. **是否立即实施完整方案？** 还是可以先只做 P0（修复工作流保存）？
2. **数据库名称和位置？** 我建议 `data/platform.db`（项目根目录下）
3. **是否需要保留旧的 JSON 文件作为备份？** 还是直接迁移后删除？
4. **API Key 是否需要加密？** 还是现阶段明文即可？

请确认以上计划，我将开始实施！
