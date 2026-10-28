# 节点名称持久化方案 - 实施计划

## 问题诊断 ✅ 已确认

### 当前状态分析

**你的判断完全正确！** 节点库的名称修改确实没有保存到数据库。

#### 数据流追踪：

1. **工具区 NodeLibraryManager.vue**
   - 修改节点名称 → 只更新了前端内存中的 `nodes.value` 数组
   - `saveChanges()` 函数中有 TODO 注释（第 279 行）
   - **未调用任何后端 API**

2. **工作台 NodeLibrary.vue**
   - 使用的数据源是 `nodeRegistry`（[nodeRegistry.ts](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/src/config/nodeRegistry.ts)）
   - 这是一个**纯内存的 Map 数据结构**
   - 所有操作都在前端内存中，无持久化逻辑

3. **数据库层面**
   - 项目使用 SQLite 数据库（[init.sql](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/server/init.sql)）
   - **没有专门的"节点定义表"或"节点自定义配置表"**
   - 但有现成的 `user_settings` 表可以复用！

4. **后端 API 层**
   - 在 [vite.config.ts](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/vite.config.ts) 第 320-348 行已实现用户设置 API
   - 端点：`GET/PUT /api/settings/:key`
   - Repository：[UserSettingsRepo.ts](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/server/repositories/UserSettingsRepo.ts)

---

## 解决方案设计 🎯

### 方案选择：复用 user_settings 表

**优势：**
- ✅ 不需要新建数据库表
- ✅ 复用现有的 Repository 和 API 端点
- ✅ 符合 KV 结构（key-value），适合存储节点名称映射
- ✅ 跨设备同步友好（未来可扩展云同步）
- ✅ 实现简单，改动最小

**数据存储格式：**
```
Key:    node_name_KSampler
Value:  "我的采样器"

Key:    node_name_LoadImage
Value:  "图片加载器"
```

---

## 详细实施步骤

### 步骤 1: 创建节点名称管理服务（前端）

**文件**: 新建 `src/services/nodeNameOverrides.ts`

**功能：**
```typescript
// 核心接口
interface NodeNameOverrideService {
  // 加载所有节点名称覆盖
  loadOverrides(): Promise<Map<string, string>>

  // 保存单个节点名称
  saveOverride(nodeType: string, customName: string): Promise<void>

  // 删除某个节点的自定义名称
  removeOverride(nodeType: string): Promise<void>

  // 获取某个节点的显示名称（优先返回自定义名称）
  getDisplayName(nodeType: string, defaultName: string): Promise<string>
}
```

**实现细节：**
- 封装对 `/api/settings` 的调用
- 本地缓存已加载的 overrides（避免重复请求）
- 提供 reactive 响应式数据供 Vue 组件使用

### 步骤 2: 修改工具区 NodeLibraryManager.vue

**改动位置**: [NodeLibraryManager.vue](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/src/components/tools/NodeLibraryManager.vue)

**具体改动：**

#### 2.1 导入服务
```typescript
import { useNodeNameOverrides } from '@/services/nodeNameOverrides'
const { getDisplayName, saveOverride, loadOverrides } = useNodeNameOverrides()
```

#### 2.2 初始化时加载覆盖数据
```typescript
onMounted(async () => {
  const registeredNodes = nodeRegistry.getAll()
  nodes.value = registeredNodes.map(reg => ({...}))

  // 新增：加载用户自定义的节点名称
  await loadOverrides()
})
```

#### 2.3 修改 selectNode 函数
```typescript
async function selectNode(node: NodeInfo) {
  // ... 原有逻辑 ...

  // 新增：优先显示自定义名称
  editingName.value = await getDisplayName(node.type, node.name)
  originalName.value = editingName.value
}
```

#### 2.4 修改 saveChanges 函数
```typescript
async function saveChanges() {
  if (!selectedNode.value || !editingName.value.trim()) {
    showSaveMessage('请输入有效的节点名称', true)
    return
  }

  try {
    // 新增：调用 API 保存到数据库
    await saveOverride(selectedNode.value.type, editingName.value.trim())

    // 更新本地状态
    const node = nodes.value.find(n => n.type === selectedNode.value!.type)
    if (node) {
      node.name = editingName.value.trim()
      selectedNode.value = { ...node }
      originalName.value = node.name
    }

    showSaveMessage(`节点 "${editingName.value.trim()}" 已保存`, false)
  } catch (err) {
    showSaveMessage(`保存失败: ${err instanceof Error ? err.message : err}`, true)
  }
}
```

#### 2.5 显示区分默认名称和自定义名称
在编辑器面板中添加视觉提示：
```vue
<div class="form-group">
  <label>节点名称</label>
  <input v-model="editingName" ... />
  <div v-if="isCustomName" class="custom-name-badge">✨ 自定义名称</div>
</div>
```

### 步骤 3: 修改工作台 NodeLibrary.vue

**改动位置**: [NodeLibrary.vue](file:///g:/AI%20code/trae/%E8%8A%82%E7%82%B9%E7%BC%96%E8%BE%91%E5%B7%A5%E4%BD%9C%E6%B5%81%20v0.1/src/components/workspace/NodeLibrary.vue)

**目标：让工作台的节点库也显示自定义名称**

#### 3.1 导入并初始化
```typescript
import { useNodeNameOverrides } from '@/services/nodeNameOverrides'

const { getDisplayName, loadOverrides } = useNodeNameOverrides()

onMounted(async () => {
  await loadOverrides()  // 预加载所有自定义名称
})
```

#### 3.2 修改 categories 计算属性
```typescript
const categories = computed(() => {
  const cats = nodeRegistry.getCategories()
  return cats.map(catName => ({
    name: catName,
    nodes: nodeRegistry.getByCategory(catName).map(async (reg) => ({
      type: reg.type,
      name: await getDisplayName(reg.type, reg.name),  // 应用自定义名称
      icon: reg.icon,
      inputs: reg.inputs,
      outputs: reg.outputs
    }))
  }))
})
```

**注意**：由于 `getDisplayName` 是异步的，需要优化为批量预加载模式（见步骤 1 的缓存机制）

### 步骤 4: 创建响应式状态管理（可选但推荐）

**文件**: `src/stores/nodeOverrides.ts` 或直接集成到 `src/stores/app.ts`

**目的：**
- 全局共享节点名称覆盖数据
- 当工具区修改后，工作台自动更新（无需刷新页面）
- 使用 Vue 的 reactive/ref 实现响应式

**核心代码结构：**
```typescript
// stores/nodeOverrides.ts
import { ref, computed } from 'vue'

const overrides = ref<Map<string, string>>(new Map())
const isLoading = ref(false)

export function useNodeOverrides() {
  async function loadFromServer() {
    isLoading.value = true
    try {
      const res = await fetch('/api/settings')
      const settings = await res.json()

      const map = new Map<string, string>()
      settings.forEach((s: { key: string; value: string }) => {
        if (s.key.startsWith('node_name_')) {
          const nodeType = s.key.replace('node_name_', '')
          map.set(nodeType, s.value)
        }
      })

      overrides.value = map
    } finally {
      isLoading.value = false
    }
  }

  async function saveToServer(nodeType: string, name: string) {
    await fetch(`/api/settings/node_name_${nodeType}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: name })
    })

    overrides.value.set(nodeType, name)
    // 触发响应式更新
    overrides.value = new Map(overrides.value)
  }

  function getDisplayName(nodeType: string, defaultName: string): string {
    return overrides.value.get(nodeType) || defaultName
  }

  return {
    overrides: computed(() => overrides.value),
    isLoading,
    loadFromServer,
    saveToServer,
    getDisplayName
  }
}
```

### 步骤 5: 添加 UI 反馈增强

#### 5.1 在节点列表项中标记自定义名称
```vue
<!-- NodeLibrary.vue 和 NodeLibraryManager.vue -->
<span class="node-name">
  {{ node.name }}
  <span v-if="hasCustomName(node.type)" class="custom-indicator" title="已自定义">✏️</span>
</span>
```

#### 5.2 在编辑器中添加重置按钮
```vue
<button
  v-if="isCustomName"
  class="btn-reset-default"
  @click="resetToDefaultName"
  title="恢复为默认名称"
>
  ↩️ 恢复默认
</button>
```

### 步骤 6: 测试验证清单

#### 功能测试：
- [ ] 工具区修改节点名称 → 点击保存
- [ ] 切换到工作台 → 打开节点库菜单 → 确认名称已更新（无需刷新页面）
- [ ] 刷新浏览器 → 重新打开应用 → 确认名称仍然保持
- [ ] 重启开发服务器 → 确认数据持久化正常

#### 边界情况测试：
- [ ] 清空名称 → 应提示错误
- [ ] 输入超长名称（>100字符）→ 应截断或提示
- [ ] 特殊字符（<script> 等）→ 应过滤或转义
- [ ] 快速连续点击保存 → 不应产生重复请求
- [ ] 网络断开时保存 → 应显示错误提示
- [ ] 并发修改同一节点 → 后写入生效

#### 性能测试：
- [ ] 节点数量 > 100 时搜索性能
- [ ] 批量加载自定义名称时的延迟
- [ ] 内存占用是否合理

---

## 文件变更清单

| 操作 | 文件路径 | 改动说明 |
|------|---------|---------|
| **新建** | `src/services/nodeNameOverrides.ts` | 节点名称管理服务 |
| **新建** | `src/stores/nodeOverrides.ts` | 全局响应式状态（可选） |
| **修改** | `src/components/tools/NodeLibraryManager.vue` | 集成持久化逻辑 |
| **修改** | `src/components/workspace/NodeLibrary.vue` | 显示自定义名称 |
| **无需修改** | `server/repositories/UserSettingsRepo.ts` | 已支持 CRUD |
| **无需修改** | `vite.config.ts` | API 端点已存在 |

---

## 技术细节说明

### 为什么选择 user_settings 表？

1. **KV 结构天然适配**：节点类型 → 自定义名称，就是典型的键值对
2. **零额外成本**：表、Repository、API 全部就绪
3. **扩展性强**：未来可存储更多节点属性（图标、颜色、分类等）
4. **查询高效**：SQLite 对主键查询 O(1) 复杂度

### 性能优化策略

1. **批量加载**：启动时一次性 GET /api/settings，客户端筛选 `node_name_` 前缀
2. **本地缓存**：内存中维护 Map，避免重复请求
3. **响应式更新**：使用 Vue ref/reactive，修改后立即反映到所有组件
4. **防抖保存**：可选添加 500ms 防抖，避免频繁写入数据库

### 数据一致性保障

1. **乐观更新**：先更新 UI，再发送请求，失败时回滚
2. **冲突处理**：最后写入胜出（LWW）策略，适合单用户场景
3. **错误恢复**：保存失败时保留原始值，提示用户重试

---

## 预期效果演示

### 场景 1：工具区修改名称
```
1. 用户在工具区节点库选择 "KSampler" 节点
2. 右侧编辑器将名称改为 "高质量采样器"
3. 点击 "保存修改"
4. 系统显示："✅ 节点 '高质量采样器' 已保存到数据库"
```

### 场景 2：工作台即时同步
```
1. 用户切换到"工作台"标签页
2. 点击左侧图标栏的"节点库"按钮
3. 展开"计算"分类
4. 看到 "KSampler" 已变成 "高质量采样器" ← 无需刷新！
```

### 场景 3：持久化验证
```
1. 用户关闭浏览器
2. 重新打开应用
3. 进入工具区或工作台
4. 节点名称仍然是 "高质量采样器" ← 数据已持久化！
```

---

## 扩展性考虑（未来可做）

### Phase 2 功能预留：
- **节点图标自定义**：`node_icon_{type}` → emoji 或 SVG path
- **节点颜色标记**：`node_color_{type}` → 十六进制色值
- **节点描述编辑**：`node_desc_{type}` → 多行文本
- **节点分组调整**：`node_category_{type}` → 移动到其他分类
- **批量导出/导入**：将所有自定义设置导出为 JSON 文件

### 云同步准备：
- 当前方案基于本地 SQLite
- 未来可将 `user_settings` 表同步到云端
- 支持多设备间配置共享

---

## 时间估算

- 创建 nodeNameOverrides 服务：30 分钟
- 修改 NodeLibraryManager.vue：40 分钟
- 修改 NodeLibrary.vue：30 分钟
- 可选：创建全局 store：20 分钟
- UI 增强（标记、提示）：20 分钟
- 测试与调试：30 分钟
- **总计约 3 小时**

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| API 响应慢 | 低 | 中 | 添加 loading 状态 + 缓存 |
| 并发冲突 | 极低 | 低 | LWW 策略足够（单用户场景）|
| 数据损坏 | 极低 | 高 | 定期备份 + 错误处理 |
| 浏览器兼容性 | 极低 | 低 | 使用标准 Fetch API |

---

*计划版本: 1.0*
*创建时间: 2026-04-22*
*状态: 待审批*
