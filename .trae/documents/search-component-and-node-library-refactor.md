# 通用搜索组件与节点库改造计划

## 项目概述

基于 Vue 3 + TypeScript 的节点编辑工作流应用，需要实现两个核心功能：
1. 创建可复用的通用搜索组件，统一各模块的搜索体验
2. 将工具区的节点库改为左右分栏结构（选择-编辑模式）

---

## 一、通用搜索组件设计与实现

### 1.1 创建通用搜索组件

**文件位置**: `src/components/common/SearchBar.vue`

**组件特性**:
- 统一的视觉样式（参考现有 NodeLibraryManager.vue 第135-157行的搜索框样式）
- 支持自定义 placeholder 文本
- 支持实时搜索（v-model 双向绑定）
- 支持防抖优化（可选配置）
- 响应式设计，适应不同容器宽度
- 支持 clear 按钮（一键清空）
- 支持 focus 状态视觉反馈

**Props 接口设计**:
```typescript
interface Props {
  modelValue: string           // v-model 绑定值
  placeholder?: string         // 占位文本，默认 '搜索...'
  debounce?: number            // 防抖时间(ms)，默认 0（不防抖）
  showClear?: boolean          // 是否显示清除按钮，默认 true
  size?: 'small' | 'medium' | 'large'  // 尺寸，默认 'medium'
}
```

**Emits 事件**:
- `update:modelValue` - 值更新事件
- `search` - 触发搜索事件（防抖后或回车时）
- `clear` - 清除按钮点击事件

### 1.2 在各页面集成搜索组件

#### 1.2.1 工具区 - ComfyUI 工作流页面
**文件**: `src/components/tools/WorkflowEditor.vue`

**改动点**:
- 在左侧 `.workflow-sidebar` 的 `.sidebar-header` 按钮组下方添加 SearchBar 组件
- 搜索位置：第15行之后（在新建/导入/分类按钮下方）
- 搜索数据源：`workflows` 数组
- 搜索字段：`name`（工作流名称）
- 过滤逻辑：根据 searchQuery 过滤显示的工作流列表
- 样式调整：确保搜索框宽度适配侧边栏（320px）

**实现细节**:
```vue
<!-- 在 sidebar-header 后添加 -->
<div class="search-section">
  <SearchBar
    v-model="workflowSearchQuery"
    placeholder="搜索工作流..."
    size="small"
    @search="onWorkflowSearch"
  />
</div>
```

#### 1.2.2 配置中心 - ComfyUI 配置页面
**文件**: `src/components/settings/ComfyUIConfigManager.vue`

**改动点**:
- 在左侧 `.left-panel` 的 `.list-header` 区域内或下方添加 SearchBar
- 搜索位置：第9行（list-title 旁边或下方）
- 搜索数据源：`configs` 数组
- 搜索字段：`name`（配置名称）、`url`（服务地址）
- 过滤逻辑：过滤配置列表显示

**实现细节**:
```vue
<div class="list-header">
  <span class="list-title">已保存的配置</span>
  <button class="btn-primary" @click="createNewConfig">+ 新建配置</button>
</div>
<!-- 新增搜索框 -->
<div class="search-wrapper">
  <SearchBar
    v-model="configSearchQuery"
    placeholder="搜索配置..."
    size="small"
  />
</div>
```

#### 1.2.3 配置中心 - 大模型 API 页面
**文件**: `src/components/settings/LLMAPIConfig.vue`

**改动点**:
- 在左侧 `.left-panel` 的 `.list-header` 下方添加 SearchBar
- 搜索位置：第6行后
- 搜索数据源：`providers` 数组
- 搜索字段：`name`（服务商名称）、`description`（描述）
- 过滤逻辑：过滤服务商列表

#### 1.2.4 工作台 - 节点库面板
**文件**: `src/components/workspace/NodeLibrary.vue`

**改动点**:
- 在组件顶部（`.node-library` 内部最前面）添加 SearchBar
- 搜索数据源：`categories` 计算属性中的所有节点
- 搜索字段：`name`（节点名称）、`type`（节点类型）
- 过滤逻辑：跨分类过滤节点，显示匹配的分类和节点
- 当搜索时展开所有包含匹配节点的分类

#### 1.2.5 工作台 - 工作流菜单
**文件**: 需要确认具体文件位置（可能是 WorkspaceTab.vue 或相关组件）

**改动点**:
- 在工作流列表顶部添加 SearchBar
- 搜索工作流名称
- 过滤工作流列表显示

---

## 二、工具区节点库改为左右分栏结构

### 2.1 整体架构重构

**目标**: 将 `NodeLibraryManager.vue` 从单列卡片网格改为左右分栏模式
- **左面板**：节点分类树形列表 + 搜索
- **右面板**：选中节点的详情编辑器（当前支持修改名称，预留扩展接口）

**参考模板**: `WorkflowEditor.vue` 的布局结构（已验证可行）

### 2.2 左侧面板设计

**结构**:
```
┌─────────────────────────┐
│ [搜索框]                │
┌─────────────────────────┤
│ ▼ 输入        (3)      │
│   ├ 数字输入             │
│   ├ 文本输入             │
│   └ 图片加载             │
│ ▼ 计算        (1)       │
│   └ 计算器               │
│ ▼ 显示        (4)       │
│   └ ...                 │
└─────────────────────────┘
```

**功能**:
- 分类折叠/展开（保留现有逻辑）
- 节点选择高亮（新增选中状态）
- 集成 SearchBar 组件
- 显示节点数量统计

### 2.3 右侧面板设计

**当前版本功能**（最小可用产品）:
- 显示选中节点的完整信息
- **可编辑字段**：节点名称（name）
- 只读信息展示：
  - 节点类型（type）
  - 所属分类（category）
  - 输入端口列表（inputs）
  - 输出端口列表（outputs）
- 保存/重置按钮

**UI 布局**:
```
┌──────────────────────────────┐
│ 节点编辑器                   │
├──────────────────────────────┤
│ 名称: [____________]         │  ← 可编辑
│                              │
│ 类型: KSampler              │  ← 只读
│ 分类: 输入                    │  ← 只读
│                              │
│ 输入端口:                     │
│   • images (IMAGE)           │
│   • seed (INT)               │
│                              │
│ 输出端口:                     │
│   • images (IMAGE)           │
│                              │
│ [保存修改]  [重置]           │
└──────────────────────────────┘
```

### 2.4 数据流设计

**状态管理**:
```typescript
// 选中状态
const selectedNodeId = ref<string | null>(null)

// 编辑状态
const editingNode = ref<Partial<NodeInfo> | null>(null)
const isEditing = ref(false)

// 原始数据备份（用于重置）
const originalNode = ref<NodeInfo | null>(null)
```

**交互流程**:
1. 用户点击左侧节点 → 加载到右侧编辑器
2. 修改名称 → 实时预览（本地状态）
3. 点击保存 → 调用 nodeRegistry.updateNode() 或 API
4. 点击重置 → 恢复原始数据
5. 选择其他节点 → 如果有未保存修改，提示确认

### 2.5 扩展性考虑

为未来功能扩展预留接口：
- **组合控件编辑**：右侧面板可插入自定义表单控件
- **属性编辑**：可扩展为键值对编辑器
- **可视化配置**：可嵌入小型画布或图表
- **插件系统**：通过 slot 或动态组件支持第三方扩展

---

## 三、实施步骤详解

### 步骤 1: 创建 SearchBar 通用组件
- [ ] 创建 `src/components/common/SearchBar.vue`
- [ ] 实现 template（input + icon + clear button）
- [ ] 实现 script setup（props、emits、防抖逻辑）
- [ ] 实现 scoped styles（统一主题变量）
- [ ] 导出组件并在需要的地方注册

### 步骤 2: 集成到 ComfyUI 工作流页面
- [ ] 修改 WorkflowEditor.vue，引入 SearchBar
- [ ] 添加 workflowSearchQuery 状态
- [ ] 实现计算属性 filteredWorkflows
- [ ] 更新模板使用 filteredWorkflows 替代 workflows
- [ ] 调整样式确保布局协调

### 步骤 3: 集成到配置中心 - ComfyUI
- [ ] 修改 ComfyUIConfigManager.vue，引入 SearchBar
- [ ] 添加 configSearchQuery 状态
- [ ] 实现过滤逻辑
- [ ] 更新模板渲染

### 步骤 4: 集成到配置中心 - LLM API
- [ ] 修改 LLMAPIConfig.vue，引入 SearchBar
- [ ] 添加 providerSearchQuery 状态
- [ ] 实现过滤逻辑
- [ ] 更新模板渲染

### 步骤 5: 集成到工作台 - 节点库
- [ ] 修改 NodeLibrary.vue，引入 SearchBar
- [ ] 添加 nodeSearchQuery 状态
- [ ] 实现跨分类搜索过滤
- [ ] 处理分类自动展开逻辑
- [ ] 更新模板渲染

### 步骤 6: 集成到工作台 - 工作流菜单
- [ ] 定位工作流菜单组件文件
- [ ] 引入 SearchBar 组件
- [ ] 实现搜索过滤逻辑

### 步骤 7: 重构 NodeLibraryManager 为左右分栏
- [ ] 重新设计整体布局（flex 左右分栏）
- [ ] 实现左侧分类列表面板
- [ ] 实现右侧节点编辑面板
- [ ] 实现节点选择逻辑
- [ ] 实现名称编辑功能
- [ ] 实现保存/重置逻辑
- [ ] 添加空状态提示
- [ ] 调整响应式布局
- [ ] 测试交互流程

### 步骤 8: 样式统一与优化
- [ ] 确保 SearchBar 在所有位置的样式一致性
- [ ] 检查暗色主题兼容性（使用 CSS 变量）
- [ ] 优化移动端/小屏幕适配
- [ ] 添加过渡动画（如需）

### 步骤 9: 测试与文档
- [ ] 手动测试每个集成的搜索功能
- [ ] 测试节点库左右分栏的所有交互场景
- [ ] 验证边界情况（空结果、特殊字符、长文本等）
- [ ] 性能测试（大量数据的搜索性能）

---

## 四、关键技术决策

### 4.1 搜索实现策略
- **客户端过滤**：对于已加载的数据（如节点库），在前端用 computed 实现
- **API 搜索**：对于大量数据（如工作流历史），可后续扩展为调用后端搜索接口
- **防抖时机**：300ms 防抖避免频繁触发，提升性能

### 4.2 组件通信模式
- 使用 `v-model` 实现双向绑定（符合 Vue 3 最佳实践）
- 通过 props 向下传递配置，通过 events 向上传递用户操作
- 保持组件的无副作用性（pure UI component）

### 4.3 样式系统
- 复用现有 CSS 变量体系（`--comfy-*` 系列）
- 保持与现有组件的视觉一致性
- 使用 scoped styles 避免污染全局样式

### 4.4 数据持久化策略
- 节点名称修改：优先调用 nodeRegistry API（如果存在）或本地存储
- 即时保存 vs 显式保存：采用显式保存（用户点击保存按钮），避免误操作

---

## 五、预期成果

完成后将实现：

✅ **统一的搜索体验**
   - 所有模块使用相同样式的搜索框
   - 一致的交互行为（聚焦、输入、清除）
   - 易于维护的单一代码来源

✅ **增强的工作区效率**
   - 快速定位工作流、配置、节点、服务商
   - 减少手动滚动查找的时间成本

✅ **现代化的节点管理界面**
   - 直观的左右分栏布局
   - 可视化的节点属性编辑
   - 为未来复杂功能奠定基础

✅ **良好的可维护性**
   - 组件高度解耦，易于单独测试
   - 清晰的类型定义（TypeScript）
   - 符合 Vue 3 Composition API 最佳实践

---

## 六、风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 搜索性能问题（大数据量） | 卡顿 | 实现虚拟滚动或分页加载 |
| 样式冲突 | 视觉异常 | 强制使用 scoped + BEM 命名 |
| 节点编辑数据丢失 | 用户体验差 | 添加未保存提示 + 自动草稿 |
| 浏览器兼容性 | 功能异常 | 目标现代浏览器，避免实验性 API |

---

## 七、时间估算（供参考）

- SearchBar 组件开发：30 分钟
- 各页面集成（6处）：每处 15-20 分钟 ≈ 2 小时
- NodeLibraryManager 重构：1.5-2 小时
- 样式调整与测试：1 小时
- **总计约 5-6 小时**

---

*计划版本: 1.0*
*创建时间: 2026-04-22*
