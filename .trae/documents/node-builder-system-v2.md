# 节点可视化编辑系统 - 完整实施方案 v2.0

## 🎯 项目目标

构建一个**可视化的节点组合编辑系统**，让用户能够：
1. 从**基础控件库**选择标准 UI 组件
2. 从**样式配置库**选择统一样式规范
3. 自由**组合控件和端口**，创建自定义节点
4. 保存到数据库，在工作台中直接使用

---

## 📐 系统架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    工具区 (ToolsTab)                          │
│                                                             │
│  ┌───────────┐ ┌───────────┐ ┌─────────────────────────┐   │
│  │  节点库    │ │ 基础控件库 │ │     样式配置库          │   │
│  │ (现有)     │ │ (新增)     │ │     (新增)              │   │
│  └─────┬─────┘ └─────┬─────┘ └───────────┬─────────────┘   │
│        │             │                   │                 │
│        ▼             ▼                   ▼                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              节点组合编辑器 (新增)                      │   │
│  │  ┌────────────┬──────────────────────────────────┐  │   │
│  │  │ 左侧:      │ 右侧:                             │  │   │
│  │  │ 控件列表   │ 可视化画布/属性面板               │  │   │
│  │  │ + 端口列表 │                                   │  │   │
│  │  └────────────┴──────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 数据流架构

```
用户操作 → 前端组件 → API 层 → Repository → SQLite 数据库
                ↓
           状态管理 (Pinia Store)
                ↓
         实时同步到工作台
```

---

## 🗄️ 数据库设计

### 新增表结构

#### 表1: `control_library` - 基础控件库
```sql
CREATE TABLE IF NOT EXISTS control_library (
  id TEXT PRIMARY KEY,
  control_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'basic',
  icon TEXT DEFAULT '📦',
  description TEXT DEFAULT '',
  config_schema TEXT NOT NULL DEFAULT '{}',
  default_style TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER DEFAULT 1,
  is_enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 预置的 15 种基础控件
INSERT INTO control_library VALUES
('ctrl-label',      'label',       '文本标签',       'display',  '🏷️',  '显示静态文本或变量值',          '{"placeholder":"","maxLines":1}',            '{}', 1, 1, 1,  NOW, NOW),
('ctrl-input',      'input',       '单行输入框',     'input',    '✏️',  '文本或数值的单行输入',           '{"type":"text","maxLength":255}',          '{}', 1, 1, 2,  NOW, NOW),
('ctrl-number',     'number',      '数字输入框',     'input',    '🔢',  '数值输入，支持步进和范围',        '{"min":0,"max":100,"step":1,"precision":2}','{}', 1, 1, 3,  NOW, NOW),
('ctrl-select',     'select',      '下拉选择框',     'selection','📋',  '从预定义选项中选择一项',          '{"options":[],"multiple":false,"searchable":false}','{}', 1, 1, 4,  NOW, NOW),
('ctrl-switch',     'switch',      '开关',          'toggle',   '🔘',  '布尔值的开关切换',               '{"defaultChecked":false,"size":"default"}',   '{}', 1, 1, 5,  NOW, NOW),
('ctrl-radio',      'radio_group', '单选框组',       'selection','⚪',  '从多个选项中选择一个',            '{"options":[],"direction":"vertical"}',      '{}', 1, 1, 6,  NOW, NOW),
('ctrl-checkbox',   'checkbox_group','多选框组',     'selection','☑️',  '从多个选项中选择多个',            '{"options":[],"direction":"vertical"}',      '{}', 1, 1, 7,  NOW, NOW),
('ctrl-button',     'button',      '普通按钮',       'action',   '🔘',  '触发操作或事件',                  '{"type":"primary","size":"medium"}',       '{}', 1, 1, 8,  NOW, NOW),
('ctrl-textarea',   'textarea',    '多行文本域',     'input',    '📝',  '多行文本输入或富文本编辑',         '{"rows":4,"maxLength":5000,"richText":false}','{}', 1, 1, 9,  NOW, NOW),
('ctrl-datetime',   'datetime',    '日期时间选择器', 'input',    '📅',  '选择日期和时间',                   '{"format":"YYYY-MM-DD HH:mm","showTime":true}','{}', 1, 1, 10, NOW, NOW),
('ctrl-code_editor','code_editor', '代码编辑器',     'advanced', '💻',  '代码编写和语法高亮',               '{"language":"javascript","theme":"dark"}',  '{}', 1, 1, 11, NOW, NOW),
('ctrl-upload',     'upload',      '文件上传',       'input',    '📤',  '上传文件到服务器或本地',           '{"accept":"*/*","maxSize":10,"multiple":false}','{}', 1, 1, 12, NOW, NOW),
('ctrl-cascader',   'cascader',    '级联选择器',     'selection','🌳',  '多级联动选择',                     '{"options":[],"changeOnSelect":false}',       '{}', 1, 1, 13, NOW, NOW),
('ctrl-color_picker','color_picker','颜色选择器',    'input',    '🎨',  '选择颜色值',                       '{"format":"hex","presets":[]}',              '{}', 1, 1, 14, NOW, NOW),
('ctrl-tip',        'tip',         '提示/说明标签',   'display',  '💡',  '显示提示信息或状态徽章',           '{"variant":"info","placement":"top"}',      '{}', 1, 1, 15, NOW, NOW);
```

#### 表2: `style_presets` - 样式配置库
```sql
CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY,
  preset_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  config JSON NOT NULL DEFAULT '{}',
  is_system INTEGER DEFAULT 1,
  is_enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 分类: port(端点), node(节点), control(控件), effect(特效)
INSERT INTO style_presets VALUES
-- 端点样式
('port-default-circle',   '默认圆形端点',   'port',  '标准的圆形端口',          '{"shape":"circle","size":8,"borderWidth":2}', 1, 1, NOW, NOW),
('port-small-dot',       '小圆点端点',     'port',  '紧凑的小圆点',            '{"shape":"circle","size":5,"borderWidth":1}',  1, 1, NOW, NOW),
('port-square',          '方形端点',       'port',  '方形设计风格',            '{"shape":"square","size":8,"borderRadius":2}',1, 1, NOW, NOW),
('port-diamond',         '菱形端点',       'port',  '菱形特殊标记',            '{"shape":"diamond","size":10}',                  1, 1, NOW, NOW),

-- 端点颜色方案
('color-data-type',      '数据类型着色',   'port',  '根据数据类型自动着色',    '{"mode":"auto","customColor":null}',           1, 1, NOW, NOW),
('color-custom',         '自定义颜色',     'port',  '手动指定端口颜色',         '{"mode":"fixed","customColor":"#6366f1"}',     1, 1, NOW, NOW),

-- 节点样式
('node-default-dark',    '默认暗色主题',   'node',  '深色背景的节点样式',       '{"bg":{"primary":"#1a1a1e","secondary":"#252529","tertiary":"#2a2a3e"},"border":{"color":"#3a3a3e","width":1},"radius":12,"headerHeight":36}', 1, 1, NOW, NOW),
('node-modern-glass',    '现代玻璃态',     'node',  '毛玻璃效果',               '{"bg":{"primary":"rgba(30,30,40,0.8)","secondary":"rgba(40,40,55,0.9)"},"border":{"color":"rgba(255,255,255,0.1)","width":1},"backdropBlur":10,"radius":16}', 1, 1, NOW, NOW),
('node-minimal',        '极简风格',       'node',  '扁平化无阴影',             '{"bg":{"primary":"#ffffff","secondary":"#f8f9fa"},"border":{"color":"#e5e7eb","width":1},"shadow":"none","radius":8}', 1, 1, NOW, NOW),

-- 控件样式
('control-comfyui',     'ComfyUI 风格',   'control','匹配 ComfyUI 的控件外观',  '{"inputBg":"#252529","borderColor":"#3a3a3e","focusColor":"#6366f1","textColor":"#e8e8ed","fontSize":12}', 1, 1, NOW, NOW),
('control-modern',      '现代简约',       'control','简洁现代的控件样式',       '{"inputBg":"#ffffff","borderColor":"#d1d5db","focusColor":"#3b82f6","textColor":"#111827","fontSize":13}', 1, 1, NOW, NOW),

-- 运行时特效
('effect-pulse-success','成功脉冲',       'effect','执行成功时的脉冲动画',     '{"type":"pulse","color":"#22c55e","duration":1000,"repeat":2}', 1, 1, NOW, NOW),
('effect-pulse-error',  '错误闪烁',       'effect','出错时的红色闪烁',         '{"type":"blink","color":"#ef4444","duration":500,"repeat":3}', 1, 1, NOW, NOW),
('effect-glow-active',  '激活发光',       'effect','节点激活时的发光效果',     '{"type":"glow","color":"#6366f1","intensity":20,"spread":10}', 1, 1, NOW, NOW)
;
```

#### 表3: `custom_nodes` - 用户自定义节点
```sql
CREATE TABLE IF NOT EXISTS custom_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '自定义',
  icon TEXT DEFAULT '📦',
  description TEXT DEFAULT '',

  -- 结构定义 (JSON)
  controls TEXT NOT NULL DEFAULT '[]',
  inputs TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]',

  -- 样式引用
  node_style_id TEXT,
  port_style_id TEXT,
  control_style_id TEXT,

  -- 元数据
  width INTEGER DEFAULT 240,
  height INTEGER DEFAULT 0,
  is_resizable INTEGER DEFAULT 1,

  -- 状态
  is_enabled INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (node_style_id) REFERENCES style_presets(id),
  FOREIGN KEY (port_style_id) REFERENCES style_presets(id),
  FOREIGN KEY (control_style_id) REFERENCES style_presets(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_nodes_category ON custom_nodes(category);
CREATE INDEX IF NOT EXISTS idx_custom_nodes_type ON custom_nodes(type);
```

#### 表4: `node_control_instances` - 节点中的控件实例
```sql
CREATE TABLE IF NOT EXISTS node_control_instances (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  control_type TEXT NOT NULL,
  bind_to_port TEXT,
  label TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'body',
  order_index INTEGER DEFAULT 0,
  config JSON NOT NULL DEFAULT '{}',
  style_overrides JSON NOT NULL DEFAULT '{}',

  FOREIGN KEY (node_id) REFERENCES custom_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (control_type) REFERENCES control_library(control_type)
);

CREATE INDEX IF NOT EXISTS idx_control_instances_node ON node_control_instances(node_id);
```

---

## 🔧 后端 API 设计

### API 端点清单

#### 1️⃣ 基础控件库 API
```
GET    /api/control-library              → 获取所有控件（含筛选）
GET    /api/control-library/:id         → 获取单个控件详情
POST   /api/control-library              → 创建自定义控件（管理员）
PUT    /api/control-library/:id         → 更新控件
DELETE /api/control-library/:id         → 删除控件
```

#### 2️⃣ 样式配置库 API
```
GET    /api/style-presets                → 获取所有样式预设
GET    /api/style-presets/:id           → 获取单个样式详情
POST   /api/style-presets                → 创建自定义样式
PUT    /api/style-presets/:id           → 更新样式
DELETE /api/api/style-presets/:id       → 删除样式
GET    /api/style-presets/categories     → 获取分类列表
```

#### 3️⃣ 自定义节点 API
```
GET    /api/custom-nodes                → 获取所有自定义节点
GET    /api/custom-nodes/:id            → 获取单个节点完整定义
POST   /api/custom-nodes                → 创建新节点
PUT    /api/custom-nodes/:id            → 更新节点
DELETE /api/custom-nodes/:id            → 删除节点
POST   /api/custom-nodes/:id/duplicate → 复制节点
GET    /api/custom-nodes/categories     → 获取节点分类
```

#### 4️⃣ 节点组合编辑器 API（实时保存）
```
POST   /api/nodes/builder/initialize   → 初始化编辑会话
PUT    /api/nodes/builder/:sessionId   → 保存草稿
POST   /api/nodes/builder/:sessionId/publish → 发布节点
GET    /api/nodes/builder/preview      → 预览节点渲染效果
```

---

## 🎨 前端组件架构

### 目录结构

```
src/
├── components/
│   ├── tools/
│   │   ├── NodeLibrary.vue              # 节点库（已有，需增强）
│   │   ├── ControlLibrary.vue           # 【新建】基础控件库
│   │   ├── StylePresetsLibrary.vue       # 【新建】样式配置库
│   │   └── NodeBuilderEditor.vue        # 【新建】节点组合编辑器
│   │
│   ├── controls/                        # 【新建】基础控件实现
│   │   ├── BaseControl.vue              # 控件基类
│   │   ├── LabelControl.vue
│   │   ├── InputControl.vue
│   │   ├── NumberControl.vue
│   │   ├── SelectControl.vue
│   │   ├── SwitchControl.vue
│   │   ├── RadioGroupControl.vue
│   │   ├── CheckboxGroupControl.vue
│   │   ├── ButtonControl.vue
│   │   ├── TextareaControl.vue
│   │   ├── DateTimeControl.vue
│   │   ├── CodeEditorControl.vue
│   │   ├── UploadControl.vue
│   │   ├── CascaderControl.vue
│   │   ├── ColorPickerControl.vue
│   │   └── TipControl.vue
│   │
│   └── builder/                         # 【新建】节点构建器组件
│       ├── BuilderCanvas.vue            # 组合画布区域
│       ├── ControlPalette.vue           # 控件拖拽面板
│       ├── PortConfigPanel.vue          # 端口配置面板
│       ├── StyleSelector.vue            # 样式选择器
│       ├── PropertyEditor.vue           # 属性编辑器
│       └── NodePreview.vue              # 实时预览组件
│
├── stores/
│   ├── controlLibrary.ts                # 【新建】控件库状态
│   ├── stylePresets.ts                  # 【新建】样式库状态
│   ├── customNodes.ts                   # 【新建】自定义节点状态
│   └── builderSession.ts                # 【新建】编辑会话状态
│
├── services/
│   ├── controlLibraryService.ts         # 【新建】控件库API服务
│   ├── stylePresetsService.ts           # 【新建】样式库API服务
│   └── customNodeService.ts             # 【新建】自定义节点API服务
│
├── types/
│   ├── control.types.ts                 # 【新建】控件类型定义
│   ├── style.types.ts                   # 【新建】样式类型定义
│   └── nodeBuilder.types.ts             # 【新建】节点构建器类型
│
└── utils/
    └── nodeBuilder.ts                   # 【增强】节点构建工具函数
```

---

## 📋 详细实施步骤

### 第一阶段：基础设施（数据库 + API）【预计 2 小时】

#### 步骤 1.1：创建数据库表和初始化数据
- [ ] 在 `server/init.sql` 中添加 4 个新表的 CREATE 语句
- [ ] 添加预置的 15 种基础控件的 INSERT 数据
- [ ] 添加预置的样式预设 INSERT 数据
- [ ] 创建必要的索引以优化查询性能

#### 步骤 1.2：创建 Repository 层
- [ ] 新建 `server/repositories/ControlLibraryRepo.ts`
  - `findAll()`, `findById()`, `findByCategory()`, `create()`, `update()`, `delete()`
- [ ] 新建 `server/repositories/StylePresetsRepo.ts`
  - `findAll()`, `findById()`, `findByCategory()`, `create()`, `update()`, `delete()`
- [ ] 新建 `server/repositories/CustomNodesRepo.ts`
  - `findAll()`, `findById()`, `createWithControls()`, `update()`, `delete()`, `duplicate()`
- [ ] 新建 `server/repositories/NodeControlInstancesRepo.ts`
  - `findByNodeId()`, `create()`, `update()`, `delete()`, `reorder()`

#### 步骤 1.3：在 vite.config.ts 中添加 API 路由
- [ ] 导入新的 Repository 实例
- [ ] 实现 `/api/control-library` 的 CRUD 路由
- [ ] 实现 `/api/style-presets` 的 CRUD 路由
- [ ] 实现 `/api/custom-nodes` 的 CRUD 路由
- [ ] 添加日志输出确认 API 已启用

### 第二阶段：前端服务和状态管理【预计 1.5 小时】

#### 步骤 2.1：创建 TypeScript 类型定义
- [ ] 新建 `src/types/control.types.ts`
  ```typescript
  interface ControlDefinition {
    id: string
    controlType: string
    displayName: string
    category: ControlCategory
    icon: string
    description: string
    configSchema: Record<string, any>
    defaultStyle: Record<string, any>
    isSystem: boolean
  }

  type ControlCategory =
    | 'display' | 'input' | 'selection' | 'toggle' | 'action' | 'advanced'
  ```
- [ ] 新建 `src/types/style.types.ts`
  ```typescript
  interface StylePreset {
    id: string
    presetName: string
    category: StyleCategory
    description: string
    config: Record<string, any>
  }

  type StyleCategory = 'port' | 'node' | 'control' | 'effect'
  ```
- [ ] 新建 `src/types/nodeBuilder.types.ts`
  ```typescript
  interface CustomNodeDefinition {
    id: string
    name: string
    type: string
    category: string
    icon: string
    controls: ControlInstance[]
    inputs: PortDefinition[]
    outputs: PortDefinition[]
    styleRefs: {
      nodeId?: string
      portId?: string
      controlId?: string
    }
  }

  interface ControlInstance {
    id: string
    controlType: string
    bindToPort?: string
    label: string
    position: 'header' | 'body' | 'footer'
    orderIndex: number
    config: Record<string, any>
    styleOverrides?: Record<string, any>
  }
  ```

#### 步骤 2.2：创建 API 服务层
- [ ] 新建 `src/services/controlLibraryService.ts`
  - 封装对 `/api/control-library` 的所有调用
  - 包含缓存机制（避免重复请求）
  - 提供响应式数据接口
- [ ] 新建 `src/services/stylePresetsService.ts`
  - 封装对 `/api/style-presets` 的所有调用
  - 支持按分类筛选
- [ ] 新建 `src/services/customNodeService.ts`
  - 封装对 `/api/custom-nodes` 的所有调用
  - 支持创建带控件的完整节点
  - 支持发布/草稿状态管理

#### 步骤 2.3：创建 Pinia Stores
- [ ] 新建 `src/stores/controlLibrary.ts`
  - state: `controls[]`, `categories[]`, `isLoading`
  - actions: `loadControls()`, `getByCategory()`
  - getters: `systemControls`, `userControls`
- [ ] 新建 `src/stores/stylePresets.ts`
  - state: `presets[]`, `selectedPreset`
  - actions: `loadPresets()`, `selectPreset()`
  - getters: `portStyles`, `nodeStyles`, `controlStyles`
- [ ] 新建 `src/stores/customNodes.ts`
  - state: `nodes[]`, `currentEditingNode`
  - actions: `loadNodes()`, `createNode()`, `updateNode()`, `publishNode()`
  - getters: `nodesByCategory`, `publishedNodes`, `draftNodes`

### 第三阶段：基础控件库界面【预计 2 小时】

#### 步骤 3.1：创建控件基类组件
- [ ] 新建 `src/components/controls/BaseControl.vue`
  - 统一的容器样式（padding、边框、圆角）
  - 标签显示逻辑
  - 错误状态处理
  - 禁用状态处理
  - Props: `modelValue`, `label`, `disabled`, `config`, `style`
  - Emits: `update:modelValue`, `change`, `focus`, `blur`

#### 步骤 3.2：实现 15 种具体控件（按优先级排序）
**第一批（核心控件）：**
- [ ] `InputControl.vue` - 单行输入框
- [ ] `NumberControl.vue` - 数字输入框（支持步进）
- [ ] `SelectControl.vue` - 下拉选择框
- [ ] `SwitchControl.vue` - 开关切换
- [ ] `ButtonControl.vue` - 按钮

**第二批（常用控件）：**
- [ ] `LabelControl.vue` - 文本标签
- [ ] `TextareaControl.vue` - 多行文本域
- [ ] `CheckboxGroupControl.vue` - 多选框组
- [ ] `RadioGroupControl.vue` - 单选框组
- [ ] `TipControl.vue` - 提示徽章

**第三批（高级控件）：**
- [ ] `DateTimeControl.vue` - 日期时间选择器
- [ ] `ColorPickerControl.vue` - 颜色选择器
- [ ] `UploadControl.vue` - 文件上传
- [ ] `CascaderControl.vue` - 级联选择器
- [ ] `CodeEditorControl.vue` - 代码编辑器

#### 步骤 3.3：创建控件库浏览界面
- [ ] 新建 `src/components/tools/ControlLibrary.vue`
  **布局结构：**
  ```
  ┌─────────────────────────────────────┐
  │  🔍 搜索控件...                    │
  ├─────────────────────────────────────┤
  │  [全部] [输入] [选择] [开关] ...    │  ← 分类筛选标签
  ├─────────────────────────────────────┤
  │  ┌─────────────────────────────┐   │
  │  │ ✏️ 单行输入框               │   │
  │  │ 用于文本或数值的单行输入    │   │
  │  │ [预览] [查看详情]           │   │
  │  ├─────────────────────────────┤   │
  │  │ 🔢 数字输入框               │   │
  │  │ 用于数值输入，支持步进...   │   │
  │  └─────────────────────────────┘   │
  └─────────────────────────────────────┘
  ```

  **功能：**
  - 左侧：控件分类列表 + 搜索
  - 中间：控件卡片网格（图标+名称+描述）
  - 右侧：选中控件的详细配置面板
    - 控件属性编辑（label、默认值、验证规则等）
    - 样式覆盖选项
    - "添加到节点"按钮

### 第四阶段：样式配置库界面【预计 1.5 小时】

#### 步骤 4.1：创建样式配置库界面
- [ ] 新建 `src/components/tools/StylePresetsLibrary.vue`
  **布局结构：**
  ```
  ┌─────────────────────────────────────┐
  │  🎨 样式配置库                     │
  ├─────────────────────────────────────┤
  │  [端点] [节点] [控件] [特效]       │  ← 分类Tab
  ├──────────┬──────────────────────────┤
  │ 样式列表  │ 样式编辑器               │
  │          │                          │
  │ ○ 默认圆形│ 端点形状: [●]           │
  │ ○ 方形   │ 大小:    [8px]          │
  │ ○ 菱形   │ 边框:    [2px]          │
  │          │ 颜色:    [🎨 选择...]    │
  │          │                          │
  │          │ [预览效果]               │
  │          │ [保存为自定义]           │
  └──────────┴──────────────────────────┘
  ```

  **功能：**
  - 分类 Tab 切换（端点/节点/控件/特效）
  - 左侧：预设样式列表（系统内置 + 用户自定义）
  - 右侧：
    - 样式属性编辑器（动态表单，根据类别变化）
    - 实时预览（渲染示例端点/节点/控件）
    - 复制/导出/导入功能

#### 步骤 4.2：实现样式预览组件
- [ ] 新建 `src/components/builder/PortStylePreview.vue`
  - 渲染不同形状和大小的端口
  - 应用当前选择的样式配置
  - 支持悬停动画预览
- [ ] 新建 `src/components/builder/NodeStylePreview.vue`
  - 渲染示例节点框架
  - 显示 Header 和 Body 区域
  - 应用节点样式配置
- [ ] 新建 `src/components/builder/ControlStylePreview.vue`
  - 渲染示例控件（如 Input 或 Button）
  - 应用控件样式配置

### 第五阶段：节点组合编辑器（核心功能）【预计 3 小时】

#### 步骤 5.1：创建编辑器主框架
- [ ] 新建 `src/components/tools/NodeBuilderEditor.vue`
  **布局（左右分栏，与节点库一致）：**

  ```
  ┌─────────────────────────────────────────────────────┐
  │  节点组合编辑器                                      │
  ├──────────────────────┬──────────────────────────────┤
  │  左侧面板 (320px)    │  右侧编辑区 (flex-1)          │
  │                      │                               │
  │  ┌────────────────┐  │  ┌─────────────────────────┐ │
  │  │ 📝 基本信息    │  │  │ 节点名称: [__________] │ │
  │  ├────────────────┤  │  │ 图标: [📦] 分类: [▼]   │ │
  │  │ 名称: [____]  │  │  │                         │ │
  │  │ 图标: [📦]    │  │  │ ┌─ 端口配置 ──────────┐ │ │
  │  │ 分类: [▼]     │  │  │ │ 输入端口:            │ │ │
  │  ├────────────────┤  │  │ │ [+ 添加输入]         │ │ │
  │  │ 🎨 样式选择    │  │  │ │ ○ value (Number) ✕ │ │ │
  │  ├────────────────┤  │  │ │ ○ image (Image)  ✕ │ │ │
  │  │ 节点: [默认]  │  │  │ │                     │ │ │
  │  │ 端点: [圆形]  │  │  │ │ 输出端口:            │ │ │
  │  │ 控件: [Comfy] │  │  │ │ [+ 添加输出]         │ │ │
  │  ├────────────────┤  │  │ │ ● result (Any)  ✕  │ │ │
  │  │ 🧩 控件库      │  │  │ └─────────────────────┘ │ │
  │  ├────────────────┤  │  │                         │ │
  │  │ [拖拽控件到右侧]│  │  │ ┌─ 控件列表 ──────────┐ │ │
  │  │              │  │  │ │ 输入数值: [Input    ] │ │ │
  │  │ • Input      │  │  │ │ 处理模式: [Select   ] │ │ │
  │  │ • Select     │  │  │ │ 启用:     [Switch    ] │ │ │
  │  │ • Switch     │  │  │ │ [+] 添加控件          │ │ │
  │  │ • Button     │  │  │ │                         │ │ │
  │  │ • ...        │  │  │ └─────────────────────────┘ │ │
  │  └────────────────┘  │  │                         │ │
  │                      │  │ [💾 保存草稿] [✅ 发布]  │ │
  │                      │  └─────────────────────────┘ │
  └──────────────────────┴──────────────────────────────┘
  ```

#### 步骤 5.2：实现控件拖拽功能
- [ ] 新建 `src/components/builder/ControlPalette.vue`
  - 显示可用控件列表（从 controlLibrary store 获取）
  - 支持拖拽（使用 HTML5 Drag & Drop 或 vue-draggable）
  - 点击也可快速添加
  - 控件分类折叠/展开

#### 步骤 5.3：实现端口配置面板
- [ ] 新建 `src/components/builder/PortConfigPanel.vue`
  - 输入/输出端口列表
  - 添加端口按钮（弹出对话框）
    - 选择端口名称
    - 选择数据类型（下拉枚举：Number/String/Image/Boolean/Any/...）
    - 选择端点样式（从 stylePresets store 获取）
  - 端点项可拖拽排序
  - 删除端口按钮

#### 步骤 5.4：实现控件实例编辑
- [ ] 新建 `src/components/builder/ControlInstanceEditor.vue`
  - 显示已添加的控件列表
  - 每个控件项包含：
    - 控件类型图标和名称
    - Label 编辑
    - 绑定端口选择（下拉：选择该控件绑定到哪个输入端口）
    - 位置调整（上移/下移）
    - 配置按钮（打开详细配置弹窗）
    - 删除按钮
  - 控件顺序可拖拽调整

#### 步骤 5.5：实现实时预览功能
- [ ] 新建 `src/components/builder/NodePreview.vue`
  - 根据当前配置实时渲染节点预览
  - 显示节点框架（应用选定的节点样式）
  - Header 区域：图标 + 名称
  - Body 区域：
    - 左侧：输入端口（应用端点样式）
    - 中间：控件列表（实际渲染对应的控件组件）
    - 右侧：输出端口（应用端点样式）
  - 支持"编辑模式"和"预览模式"切换

#### 步骤 5.6：实现保存和发布逻辑
- [ ] 实现草稿保存功能
  - 收集所有配置信息
  - 调用 `customNodeService.createOrUpdate()`
  - 保存到数据库（status = 'draft'）
  - 显示成功提示
- [ ] 实现发布功能
  - 验证必填字段（至少 1 个控件或端口）
  - 生成唯一的 `type` 标识符
  - 调用 API 保存（status = 'published'）
  - 自动注册到 nodeRegistry（工作台可见）
  - 显示发布成功提示

### 第六阶段：集成与优化【预计 1.5 小时】

#### 步骤 6.1：更新工具区导航
- [ ] 修改 `src/components/tabs/ToolsTab.vue`
  - 在现有的"节点库"和"ComfyUI 工作流"旁边添加：
    - "基础控件库" 按钮 → 打开 ControlLibrary
    - "样式配置库" 按钮 → 打开 StylePresetsLibrary
  - 或者改为下拉菜单/二级 Tab

#### 步骤 6.2：增强现有节点库
- [ ] 修改 `src/components/tools/NodeLibraryManager.vue`
  - 在左侧面板顶部添加"➕ 组合新节点"按钮
  - 点击后打开 NodeBuilderEditor
  - 显示"自定义节点"分类（从 customNodes store 加载）
  - 支持对自定义节点的编辑和删除

#### 步骤 6.3：工作台集成
- [ ] 修改 `src/config/nodeRegistry.ts`
  - 添加 `registerCustom(node: CustomNodeDefinition)` 方法
  - 在应用启动时加载已发布的自定义节点
- [ ] 修改 `src/components/workspace/NodeLibrary.vue`
  - 显示自定义节点（带有特殊标识，如星标 ⭐）
  - 支持拖拽到画布（后续实现）

#### 步骤 6.4：样式统一性检查
- [ ] 确保所有新建组件使用 CSS 变量（--comfy-* 系列）
- [ ] 验证控件在不同主题下的表现
- [ ] 测试响应式布局（最小宽度支持）

#### 步骤 6.5：错误处理和边界情况
- [ ] 网络请求失败时的友好提示
- [ ] 并发编辑冲突检测
- [ ] 数据校验（名称唯一性、必填字段等）
- [ ] 撤销/重做功能（可选，使用 vue-use 或自实现）

---

## 🎯 关键技术决策

### 1. 拖拽实现方案
**推荐**: HTML5原生 Drag & Drop API
- 无需额外依赖
- 性能好
- 兼容现代浏览器
- 示例代码:
```typescript
// ControlPalette.vue
<div
  draggable="true"
  @dragstart="onDragStart($event, control)"
>
  {{ control.displayName }}
</div>

@dragstart(event: DragEvent, control: ControlDef) {
  event.dataTransfer!.setData('application/control-type', control.controlType)
  event.dataTransfer!.effectAllowed = 'copy'
}

// BuilderCanvas.vue
<div @drop="onDrop" @dragover.prevent>
  <!-- 控件放置区域 -->
</div>

async function onDrop(event: DragEvent) {
  const controlType = event.dataTransfer!.getData('application/control-type')
  // 添加控件实例到当前节点
}
```

### 2. 实时预览实现
**推荐**: 使用 Vue 的动态组件 `<component :is="...">`
```vue
<template>
  <div class="node-preview">
    <div class="preview-header">{{ nodeName }}</div>
    <div class="preview-body">
      <div v-for="input in inputs" :key="input.id" class="preview-port input-port"
           :style="portStyle">○</div>

      <component
        v-for="control in controls"
        :key="control.id"
        :is="getControlComponent(control.controlType)"
        v-model="control.value"
        :label="control.label"
        :config="control.config"
      />

      <div v-for="output in outputs" :key="output.id" class="preview-port output-port"
           :style="portStyle">●</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Controls from '@/components/controls'

function getControlComponent(type: string) {
  const map: Record<string, any> = {
    'input': Controls.InputControl,
    'number': Controls.NumberControl,
    'select': Controls.SelectControl,
    // ...
  }
  return map[type] || Controls.BaseControl
}
</script>
```

### 3. 数据持久化策略
**采用**: 乐观更新 + 后台同步
- 前端立即更新 UI（乐观）
- 异步发送到后端（后台）
- 成功：保持现状
- 失败：回滚并提示错误

### 4. 版本控制考虑
- 每次发布节点时自动递增 `version` 字段
- 保留历史版本（可选，通过 `created_at` 区分）
- 未来可支持版本回滚（Phase 3 功能）

---

## 📊 文件变更清单总览

| 操作 | 文件路径 | 说明 | 优先级 |
|------|---------|------|--------|
| **修改** | `server/init.sql` | 添加 4 个新表 + 预置数据 | P0 |
| **新建** | `server/repositories/ControlLibraryRepo.ts` | 控件库数据访问层 | P0 |
| **新建** | `server/repositories/StylePresetsRepo.ts` | 样式库数据访问层 | P0 |
| **新建** | `server/repositories/CustomNodesRepo.ts` | 自定义节点数据访问层 | P0 |
| **新建** | `server/repositories/NodeControlInstancesRepo.ts` | 控件实例数据访问层 | P0 |
| **修改** | `vite.config.ts` | 添加 3 组新 API 路由 | P0 |
| **新建** | `src/types/control.types.ts` | 控件类型定义 | P0 |
| **新建** | `src/types/style.types.ts` | 样式类型定义 | P0 |
| **新建** | `src/types/nodeBuilder.types.ts` | 构建器类型定义 | P0 |
| **新建** | `src/services/controlLibraryService.ts` | 控件库 API 服务 | P1 |
| **新建** | `src/services/stylePresetsService.ts` | 样式库 API 服务 | P1 |
| **新建** | `src/services/customNodeService.ts` | 自定义节点 API 服务 | P1 |
| **新建** | `src/stores/controlLibrary.ts` | 控件库状态管理 | P1 |
| **新建** | `src/stores/stylePresets.ts` | 样式库状态管理 | P1 |
| **新建** | `src/stores/customNodes.ts` | 自定义节点状态管理 | P1 |
| **新建** | `src/components/controls/BaseControl.vue` | 控件基类 | P1 |
| **新建** | `src/components/controls/*.vue` (15个) | 具体控件实现 | P1 |
| **新建** | `src/components/tools/ControlLibrary.vue` | 控件库界面 | P1 |
| **新建** | `src/components/tools/StylePresetsLibrary.vue` | 样式库界面 | P1 |
| **新建** | `src/components/tools/NodeBuilderEditor.vue` | 节点组合编辑器 | P1 |
| **新建** | `src/components/builder/*.vue` (6个) | 构建器子组件 | P1 |
| **修改** | `src/components/tabs/ToolsTab.vue` | 添加新入口 | P2 |
| **修改** | `src/components/tools/NodeLibraryManager.vue` | 集成自定义节点 | P2 |
| **修改** | `src/config/nodeRegistry.ts` | 支持注册自定义节点 | P2 |
| **修改** | `src/components/workspace/NodeLibrary.vue` | 显示自定义节点 | P2 |

**总计**: 约 35 个文件变更（12 新建表/Repo, 23 新建前端文件, 6 修改现有文件）

---

## ⏰ 时间估算

| 阶段 | 内容 | 工作量 | 累计时间 |
|------|------|--------|---------|
| 第一阶段 | 数据库 + API | 2 小时 | 2h |
| 第二阶段 | 服务层 + Store | 1.5 小时 | 3.5h |
| 第三阶段 | 控件库界面 | 2 小时 | 5.5h |
| 第四阶段 | 样式库界面 | 1.5 小时 | 7h |
| 第五阶段 | 节点组合编辑器 | 3 小时 | 10h |
| 第六阶段 | 集成优化 | 1.5 小时 | 11.5h |
| **测试调试** | 全流程测试 | 2 小时 | **13.5h** |

**建议分 2-3 天完成**，每天 4-6 小时。

---

## ✅ 成功验收标准

### 功能完整性
- [ ] 可以在控件库中浏览 15 种基础控件
- [ ] 可以在样式库中浏览和编辑样式预设
- [ ] 可以在节点编辑器中组合控件和端口
- [ ] 可以保存自定义节点到数据库
- [ ] 可以发布节点使其在工作台可见
- [ ] 自定义节点可以在工作台的节点库中显示
- [ ] 刷新页面后自定义节点仍然存在

### 规范性
- [ ] 所有控件遵循统一的样式规范
- [ ] 所有节点具有一致的视觉表现
- [ ] 端口样式可通过配置统一管理
- [ ] 新建的节点自动符合规范（无需手动调样式）

### 用户体验
- [ ] 拖拽操作流畅自然
- [ ] 实时预览准确反映最终效果
- [ ] 错误提示清晰易懂
- [ ] 加载状态有明确反馈
- [ ] 支持键盘快捷键（可选）

### 技术质量
- [ ] TypeScript 类型覆盖率 > 90%
- [ ] 无控制台错误或警告
- [ ] 数据库操作有事务保护
- [ ] API 有适当的错误处理
- [ ] 前端代码符合 Vue 3 Composition API 最佳实践

---

## 🚀 下一步行动

**确认此计划后，我将立即开始：**

1. ✅ **创建详细的 TodoWrite 任务分解**（按阶段拆分为 50+ 个子任务）
2. 🔨 **从第一阶段开始**：数据库设计和 API 开发
3. 📦 **并行准备第二阶段**：TypeScript 类型定义和服务层
4. 🧪 **每完成一个阶段进行功能验证**

**准备好开始这次大型升级了吗？这将彻底改变你创建和管理节点的方式！** 🎉

---

*计划版本: 2.0*
*创建时间: 2026-04-22*
*状态: 待审批*
*复杂度: ⭐⭐⭐⭐⭐ (系统级重构)*
