# 全面清除 localStorage 残留 — 迁移至 SQLite

## 问题背景

用户明确要求：**整个项目不允许使用 localStorage**。原因：
- 换浏览器/换电脑，数据全丢
- 项目要分发到其他用户电脑上使用
- 已经搭建了 SQLite 数据库，所有持久化数据应统一入库

## 排查结果：共 7 处 localStorage 使用，分两类

### 🔴 P0 — 关键业务数据（必须迁移）

| 文件 | 行号 | key | 操作 | 影响 |
|------|------|-----|------|------|
| [`stores/app.ts`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/stores/app.ts) | L117 | `'savedCanvases'` | `setItem` | **保存画布工作流（节点+连线）** |
| [`stores/app.ts`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/stores/app.ts) | L141 | `'savedCanvases'` | `getItem` | **加载画布工作流（节点+连线）** |

> ⚠️ 这是**最严重的问题**！用户在工作台里画的节点、连的线、保存的画布，全部存在 localStorage 里。换浏览器 = 全部丢失。

### 🟡 P1 — UI 偏好设置（应迁移以保持一致）

| 文件 | 行号 | key | 操作 | 说明 |
|------|------|-----|------|------|
| [`App.vue`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/App.vue) | L9 | `'theme'` | `getItem` | 启动时读取主题 |
| [`MainLayout.vue`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/components/layout/MainLayout.vue) | L81 | `'theme'` | `setItem` | 切换主题时保存 |
| [`stores/app.ts`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/stores/app.ts) | L33 | `'theme'` | `setItem` | store 层保存主题 |
| [`composables/useTheme.ts`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/composables/useTheme.ts) | L12 | `'theme'` | `setItem` | composable 保存主题 |
| [`composables/useTheme.ts`](file:///g:/AI%20code/trae/节点编辑工作流%20v0.1/src/composables/useTheme.ts) | L30 | `'theme'` | `getItem` | composable 读取主题 |

---

## 实施方案

### Step 1: 新建 `user_settings` 表（存 UI 偏好）

**文件**: `server/init.sql`

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

用途：存储主题等用户偏好设置。简单 KV 结构，扩展方便。

**文件**: `server/types.ts`
```ts
export interface UserSetting {
  key: string
  value: string
  updated_at: number
}
```

**文件**: `server/repositories/UserSettingsRepo.ts`
- `get(key)` → value | undefined
- `set(key, value)` → upsert
- `getAll()` → 所有设置

### Step 2: vite.config.ts 添加 `/api/settings` 端点

```
GET    /api/settings          → 获取所有设置
GET    /api/settings/:key     → 获取单个设置
PUT    /api/settings/:key     → 更新/创建设置
```

### Step 3: 改造 `stores/app.ts` — 画布数据走 `/api/canvas-workflows`

当前逻辑：
```ts
// 保存 → localStorage.setItem('savedCanvases', JSON.stringify(...))
// 加载 → JSON.parse(localStorage.getItem('savedCanvases'))
```

改为：
```ts
// 保存 → POST/PUT /api/canvas-workflows
// 加载 → GET /api/canvas-workflows
```

**注意**: `canvas_workflows` 表和 API 已存在！只需让 store 调用即可。

### Step 4: 清理主题相关的 5 处 localStorage

涉及 4 个文件：

| 文件 | 改动 |
|------|------|
| `composables/useTheme.ts` | `localStorage` → `fetch('/api/settings/theme')` + `PUT` |
| `stores/app.ts` | `localStorage.setItem('theme')` → 调用 API |
| `App.vue` | `localStorage.getItem('theme')` → 调用 API 或从 useTheme 获取 |
| `MainLayout.vue` | 移除直接 localStorage 调用，统一走 store |

### Step 5: 验证清单

- [ ] 启动 dev server 无报错
- [ ] 切换主题 → 刷新页面 → 主题保持 ✅
- [ ] 工作台新建画布 → 保存 → 刷新 → 画布还在 ✅
- [ ] 打开新浏览器访问 localhost → 所有数据和设置同步 ✅
- [ ] 全局搜索确认零处 `localStorage` 残留

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/init.sql` | **修改** | 新增 `user_settings` 表 |
| `server/types.ts` | **修改** | 新增 `UserSetting` 接口 |
| `server/repositories/UserSettingsRepo.ts` | **新建** | 用户设置 CRUD |
| `vite.config.ts` | **修改** | 新增 `/api/settings` 路由 |
| `src/stores/app.ts` | **修改** | 画布→API，主题→API |
| `src/composables/useTheme.ts` | **修改** | 主题→API |
| `src/App.vue` | **修改** | 移除 localStorage |
| `src/components/layout/MainLayout.vue` | **修改** | 移除 localStorage |

## 不涉及的文件

- `WorkflowEditor.vue` — 已在上轮修复 ✅
- `ComfyUIConfigManager.vue` — 已在上轮修复 ✅
- `LLMAPIConfig.vue` — 已在上轮修复 ✅
- `stores/comfyui.ts` — 已使用 fetch API ✅
