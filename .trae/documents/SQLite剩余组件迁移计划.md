# SQLite 持久化改造 - 剩余组件迁移计划

## 背景

SQLite 数据库后端已完成（4张表 + 4个 Repository + RESTful API），`WorkflowEditor.vue` 已成功迁移并测试通过。
剩余两个前端组件仍使用旧方案，需要全部迁移到 SQLite API。

---

## 当前状态分析

### ✅ 已完成
- `server/db.ts` — 数据库初始化 + WAL模式 + 旧数据迁移
- `server/init.sql` — 4张表 DDL（canvas_workflows, workflow_templates, comfyui_configs, llm_providers）
- `server/types.ts` — TypeScript 接口定义
- `server/repositories/*.ts` — 4个 Repository（CRUD 完整）
- `vite.config.ts` — 全套 RESTful API 中间件（GET/POST/PUT/DELETE）
- `src/components/tools/WorkflowEditor.vue` — 已迁移至 `/api/workflow-templates`

### ❌ 待改造

| 组件 | 当前存储方式 | 目标 API | 核心问题 |
|------|------------|----------|---------|
| ComfyUIConfigManager.vue | `useComfyUIStore` (Pinia store → 单JSON文件) | `/api/comfyui-configs` | 只支持单配置，新建配置实际是覆盖 |
| LLMAPIConfig.vue | `localStorage.getItem('llm_api_configs')` | `/api/llm-providers` | 浏览器间不同步，无法跨设备 |

---

## 实施步骤

### Step 1: 改造 ComfyUIConfigManager.vue

**文件**: `src/components/settings/ComfyUIConfigManager.vue`

**改动要点**:
1. 移除 `import { useComfyUIStore } from '@/stores/comfyui'`
2. 新增接口 `ComfyUIConfigItem` 对应后端 `ComfyUIConfig` 类型：
   ```ts
   interface ComfyUIConfigItem {
     id: string
     name: string
     url: string
     timeout: number
     autoConnect: boolean    // ← auto_connect 字段映射
     isActive: boolean       // ← is_active 字段映射
     notes: string
     createdAt: number
     updatedAt: number
   }
   ```
3. `loadConfigs()` 改为 `fetch('/api/comfyui-configs')`，解析返回数组
4. `handleSaveConfig()`:
   - 新建 → `POST /api/comfyui-configs` body: `{ name, url, timeout, auto_connect, is_active }`
   - 编辑 → `PUT /api/comfyui-configs/{id}` body 同上
5. `setActiveConfig(id)` → `PUT /api/comfyui-configs/{id}/activate`
6. `deleteConfig(id)` → `DELETE /api/comfyui-configs/{id}`，删除后重新 loadConfigs 刷新列表
7. 移除所有 `store.saveConfig()` / `store.loadConfig()` / `store.testConnection()` 调用
8. 连接测试功能保留为纯前端模拟（或后续对接真实 ComfyUI ping）

**注意**: 后端 `auto_connect` / `is_active` 是 integer (0/1)，前端用 boolean，需要做映射转换。

---

### Step 2: 改造 LLMAPIConfig.vue

**文件**: `src/components/settings/LLMAPIConfig.vue`

**改动要点**:
1. 移除所有 `localStorage` 操作：
   - 删除 `localStorage.getItem('llm_api_configs')`
   - 删除 `localStorage.setItem('llm_api_configs', ...)`
2. 新增接口对应后端 `LLMProvider` 类型：
   ```ts
   interface LLMProviderItem {
     id: string
     providerType: string    // provider_type
     name: string
     apiKey: string          // api_key
     baseUrl: string         // base_url
     defaultModel: string    // default_model
     temperature: number
     maxTokens: number       // max_tokens
     enabled: boolean        // enabled (0/1)
     extraConfig: string     // extra_config (JSON string, 存 models 等扩展信息)
     createdAt: number
     updatedAt: number
   }
   ```
3. `onMounted` 时调用 `loadProviders()` → `GET /api/llm-providers`
4. 将硬编码的 providers 数组改为从 DB 加载 + 默认模板合并策略：
   - 如果 DB 中有记录，以 DB 为准
   - 如果 DB 为空，显示默认的 4 个提供商卡片（OpenAI/Claude/Gemini/Custom）作为"待创建"状态
5. `saveAllConfigs()` 改为逐个 upsert：
   - 有 id 的 → `PUT /api/llm-providers/{id}`
   - 无 id 的（新启用的）→ `POST /api/llm-providers`
6. `models` 数组等额外信息存入 `extra_config` JSON 字段

**设计决策**: LLM 提供商采用 **"预设模板 + 用户实例"** 混合模式：
- 预设模板（OpenAI/Claude/Gemini/Custom）始终显示为卡片骨架
- 用户启用并保存后，在 DB 中创建真实记录
- 再次加载时，用 DB 数据覆盖模板默认值

---

### Step 3: 集成测试验证

启动 dev server，逐一验证：

1. **工作流编辑器**（已迁移，回归确认）:
   - [ ] 新建工作流 → 保存 → 刷新页面 → 工作流仍在
   - [ ] 编辑已有工作流 → 保存 → 刷新 → 内容更新
   - [ ] 删除工作流 → 刷新 → 确实消失
   - [ ] 连续新建多个 → 全部保留

2. **ComfyUI 配置管理**:
   - [ ] 页面加载 → 显示已迁移的旧配置
   - [ ] 新建配置 → 保存 → 出现在列表中
   - [ ] 编辑配置 → 保存 → 内容更新
   - [ ] 设为活动 → badge 正确切换
   - [ ] 删除配置 → 列表刷新
   - [ ] 刷新页面 → 所有配置持久存在

3. **LLM 提供商配置**:
   - [ ] 页面加载 → 显示默认 4 个提供商卡片
   - [ ] 启用 OpenAI → 输入 apiKey → 保存
   - [ ] 刷新页面 → OpenAI 的 apiKey 仍然存在
   - [ ] 启用多个提供商 → 分别配置 → 全部保存
   - [ ] 切换浏览器/清除缓存后 → 数据依然从 DB 加载（非 localStorage）

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/settings/ComfyUIConfigManager.vue` | **修改** | 移除 store 依赖，改用 REST API |
| `src/components/settings/LLMAPIConfig.vue` | **修改** | 移除 localStorage，改用 REST API |

**不涉及的文件**: 后端 server/ 目录、vite.config.ts、WorkflowEditor.vue（均已完成）

---

## 风险与注意事项

1. **字段命名映射**: 后端用 snake_case（auto_connect, is_active, api_key），前端用 camelCase（autoConnect, isActive, apiKey），API 层需要做转换
2. **LLM Provider 的 models 字段**: 后端没有专门的 models 列，需序列化到 `extra_config` JSON 字段中
3. **连接测试**: ComfyUI 和 LLM 的连接测试目前都是模拟的，本次不改动其逻辑，只改存储层
4. **向后兼容**: 旧数据已在首次启动时自动迁移到 SQLite，无需手动处理
