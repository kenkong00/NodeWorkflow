# 节点工作流平台开发计划

## 一、项目概述

### 1.1 项目目标

开发一个基于节点工作流的AI项目运行平台，支持：

* 可视化节点工作流编辑

* 大模型API调用

* 批量生图、生视频、图像编辑、聊天等组合功能

* 多画布管理

* 工作流持久化

* **节点内部可组合控件系统**（按钮、输入框、单选/复选、下拉、开关、选项卡、表格、弹窗、日期选择、上传、加载、提示等）

### 1.2 设计参考

**主要参考：ComfyUI 界面设计**

* 深色主题（黑色/深灰背景）

* 节点左右端口布局（左侧输入、右侧输出）

* 网格背景

* 右下角悬浮工具栏

* 节点标题栏 + 内容区结构

* 平滑连接线

**次要参考：Claude 设计系统**

* 可切换浅色/深色主题

* 温暖色调配色（浅色主题时使用）

* 优雅的圆角设计

* 统一的控件样式

***

## 二、技术架构

### 2.1 技术栈选择

| 层级    | 技术选型               | 说明                   |
| ----- | ------------------ | -------------------- |
| 前端框架  | Vue 3 + TypeScript | Composition API、类型安全 |
| 构建工具  | Vite               | 快速开发体验               |
| 节点工作流 | Vue Flow           | Vue生态成熟的节点编辑库        |
| 状态管理  | Pinia              | Vue官方推荐状态管理          |
| UI组件库 | shadcn-vue         | 无头组件 + Tailwind      |
| 样式系统  | Tailwind CSS       | 实用优先CSS              |
| 图标    | Lucide Vue         | 现代化图标库               |

### 2.2 架构设计原则

* **前后端分离**：UI层与业务逻辑层解耦

* **插件化节点**：节点类型可动态注册

* **事件驱动**：工作流执行采用事件机制

* **可扩展性**：预留API接入点和扩展接口

* **控件可组合**：节点内部控件独立注册、可自由组合复用

* **双主题支持**：深色/浅色主题无缝切换

***

## 三、项目结构设计

```
节点编辑工作流 v0.1/
├── src/
│   ├── components/              # UI组件
│   │   ├── ui/                 # shadcn-vue 基础组件
│   │   ├── canvas/             # 画布相关组件
│   │   │   ├── CanvasView.vue
│   │   │   ├── CanvasToolbar.vue  # 右下角工具栏
│   │   │   └── MiniMap.vue
│   │   ├── nodes/              # 节点组件
│   │   │   ├── BaseNode.vue
│   │   │   ├── NodeHeader.vue
│   │   │   ├── NodePort.vue    # 输入输出端口
│   │   │   └── NodeContent.vue
│   │   ├── controls/           # 节点内部控件
│   │   │   ├── ButtonControl.vue
│   │   │   ├── InputControl.vue
│   │   │   ├── RadioControl.vue
│   │   │   ├── CheckboxControl.vue
│   │   │   ├── SelectControl.vue
│   │   │   ├── SwitchControl.vue
│   │   │   ├── TabsControl.vue
│   │   │   ├── TableControl.vue
│   │   │   ├── DialogControl.vue
│   │   │   ├── DatePickerControl.vue
│   │   │   ├── UploadControl.vue
│   │   │   ├── LoadingControl.vue
│   │   │   ├── ImagePreviewControl.vue  # 图片预览
│   │   │   ├── ToastControl.vue
│   │   │   └── registry.ts     # 控件注册表
│   │   └── workspace/          # 工作区组件
│   │       ├── Workspace.vue
│   │       ├── Sidebar.vue      # 左侧节点面板
│   │       └── TopBar.vue
│   │
│   ├── features/               # 功能模块
│   │   ├── workflow/           # 工作流核心逻辑
│   │   ├── nodes/              # 节点定义与注册
│   │   ├── canvas/             # 画布管理
│   │   ├── execution/          # 执行引擎
│   │   ├── controls/           # 控件系统
│   │   │   ├── types.ts        # 控件类型定义
│   │   │   └── composer.ts     # 控件组合器
│   │   └── theme/              # 主题系统
│   │       ├── dark.ts         # 深色主题
│   │       └── light.ts        # 浅色主题
│   │
│   ├── composables/            # 组合式函数
│   │   ├── useWorkflow.ts
│   │   ├── useCanvas.ts
│   │   ├── useNodeExecution.ts
│   │   ├── useControl.ts       # 控件Hook
│   │   └── useTheme.ts         # 主题Hook
│   │
│   ├── services/               # 服务层
│   │   ├── api/                # API调用
│   │   ├── storage/            # 本地存储
│   │   └── export/             # 导入导出
│   │
│   ├── stores/                 # Pinia 状态管理
│   │   ├── app.ts
│   │   ├── canvas.ts
│   │   └── workflow.ts
│   │
│   ├── types/                  # TypeScript类型定义
│   │   ├── node.ts
│   │   ├── workflow.ts
│   │   ├── canvas.ts
│   │   ├── control.ts          # 控件类型
│   │   └── theme.ts            # 主题类型
│   │
│   ├── utils/                  # 工具函数
│   │   ├── validation.ts
│   │   ├── connection.ts
│   │   └── serialization.ts
│   │
│   ├── App.vue                 # 根组件
│   └── main.ts                 # 入口文件
│
├── public/                     # 静态资源
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

***

## 四、核心功能模块开发计划

### 阶段一：项目初始化与基础框架

**目标**：搭建项目基础架构，实现双主题系统

#### 任务清单：

1. 初始化 Vite + Vue 3 + TypeScript 项目
2. 配置 Tailwind CSS 与双主题系统

   * 深色主题（ComfyUI 风格）

   * 浅色主题（Claude 风格）
3. 集成 shadcn-vue 组件库
4. 实现基础布局（顶栏、左侧节点面板、主画布区）
5. 实现右下角悬浮工具栏
6. 创建基础样式文件和设计Token

***

### 阶段二：控件系统开发

**目标**：实现可复用的节点内部控件库

#### 4.2.1 控件类型定义

定义基础控件接口，每个控件包含：

* `id`: 控件唯一标识

* `type`: 控件类型

* `label`: 显示标签

* `value`: 控件值

* `props`: 控件特定属性

* `events`: 事件回调

* `validation`: 验证规则

#### 4.2.2 控件组件实现

| 控件类型         | 功能描述 | 属性                                                | 事件                               |
| ------------ | ---- | ------------------------------------------------- | -------------------------------- |
| Button       | 按钮   | variant, size, disabled, loading                  | click                            |
| Input        | 文本输入 | type, placeholder, disabled, maxlength, multiline | input, change, focus, blur       |
| Radio        | 单选框  | options, disabled                                 | change                           |
| Checkbox     | 复选框  | options, disabled                                 | change                           |
| Select       | 下拉选择 | options, placeholder, disabled, multiple          | change                           |
| Switch       | 开关   | disabled                                          | change                           |
| Tabs         | 选项卡  | tabs, defaultTab                                  | tabChange                        |
| Table        | 表格   | columns, data, pagination                         | rowClick, sort, filter           |
| Dialog       | 弹窗   | title, visible, closable                          | open, close, confirm, cancel     |
| DatePicker   | 日期选择 | mode, format, disabled                            | change                           |
| Upload       | 文件上传 | accept, multiple, maxSize, action                 | upload, progress, success, error |
| Loading      | 加载状态 | type, size                                        | -                                |
| ImagePreview | 图片预览 | src, alt, size                                    | click                            |
| Toast        | 提示消息 | type, duration, closable                          | close                            |

#### 4.2.3 控件注册表机制

* 动态注册控件组件

* 控件类型与组件映射

* 控件版本管理

* 控件发现与加载

#### 4.2.4 控件组合器

* 声明式控件配置

* 控件布局管理（垂直/水平/网格）

* 控件数据绑定

* 控件间联动

* 控件验证链

***

### 阶段三：节点工作流系统

**目标**：实现可视化节点编辑器核心功能（ComfyUI 风格）

#### 4.3.1 节点系统

* 定义基础节点接口（`BaseNode`）

* 节点结构：

  * **标题栏**：节点名称、状态指示器、菜单按钮

  * **内容区**：可组合控件插槽

  * **端口区**：左侧输入端口、右侧输出端口

* 节点内部控件插槽机制

* 实现节点组件渲染

* 节点拖拽创建与删除

* 节点选中状态（蓝色边框高亮）

* 节点执行状态显示（执行时间、节点ID）

#### 4.3.2 端口系统

* **输入端口**：节点左侧，圆形连接点

* **输出端口**：节点右侧，圆形连接点

* 端口类型标识（不同颜色区分）

* 端口悬停反馈

* 端口标签显示

#### 4.3.3 节点类型（含控件配置）

计划实现的初始节点类型：

| 节点类型             | 功能描述   | 内部控件                                                                                             | 输入端口                  | 输出端口       |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------ | --------------------- | ---------- |
| Load Image       | 加载图片   | UploadControl + ImagePreviewControl                                                              | 无                     | `IMAGE`    |
| Save Image       | 保存图片   | ImagePreviewControl + InputControl(文件名)                                                          | `IMAGE`               | 无          |
| Text Input       | 文本输入   | InputControl(多行)                                                                                 | 无                     | `STRING`   |
| Text Concatenate | 字符串拼接  | InputControl(text\_a) + InputControl(text\_b) + InputControl(分隔符) + SwitchControl(清理空白)          | `STRING` (多输入)        | `STRING`   |
| Show Text        | 显示文本   | InputControl(只读)                                                                                 | `STRING`              | 无          |
| LLM Chat         | 大模型聊天  | SelectControl(模型) + InputControl(提示词) + ButtonControl(发送) + ToastControl                         | `PROMPT`              | `RESPONSE` |
| Text to Image    | 文生图    | InputControl(提示词) + SelectControl(模型) + SelectControl(尺寸) + ButtonControl(生成) + LoadingControl   | `PROMPT`              | `IMAGE`    |
| Image to Image   | 图生图    | ImagePreviewControl + InputControl(提示词) + SelectControl(强度) + ButtonControl(生成)                  | `IMAGE`, `PROMPT`     | `IMAGE`    |
| Video Generate   | 视频生成   | ImagePreviewControl + InputControl(提示词) + SelectControl(时长) + ButtonControl(生成) + LoadingControl | `IMAGE`/`TEXT`        | `VIDEO`    |
| Data Aggregate   | 数据聚合   | TableControl(数据预览)                                                                               | `ANY` (多输入)           | `ANY[]`    |
| Condition        | 条件分支   | SelectControl(条件) + RadioControl(分支)                                                             | `CONDITION`, `A`, `B` | `ANY`      |
| Loop             | 循环     | InputControl(次数) + TabsControl(配置)                                                               | `ITEMS`               | `ANY[]`    |
| Custom Node      | 通用配置节点 | 动态控件组合（通过配置定义）                                                                                   | 任意                    | 任意         |

#### 4.3.4 连接机制

* 基于类型的连接验证

* 连接规则引擎

* 可视化连接反馈（平滑曲线）

* 连接删除与编辑

* 连接线条样式（不同类型不同颜色）

***

### 阶段四：画布操作功能

**目标**：实现可交互的工作流画布（ComfyUI 风格）

#### 4.4.1 单画布功能

* 画布拖拽平移

* 缩放控制（+/- 按钮 + 滚轮）

* 视口适配

* **网格背景**（深色主题深灰网格，浅色主题浅灰网格）

* 节点选中与多选

* 框选功能

* 节点对齐辅助线

#### 4.4.2 右下角悬浮工具栏

参考 ComfyUI，包含：

* 删除按钮

* 信息按钮

* 主题切换

* 缩小/放大

* 重置视图

* 撤销/重做

* **执行按钮**（蓝色播放按钮）

* 更多选项菜单

#### 4.4.3 多画布管理

* 画布列表（标签页）

* 新建画布

* 删除画布

* 画布重命名

* 画布切换

#### 4.4.4 数据持久化

* 工作流保存（本地存储 + JSON文件）

  * 节点数据

  * 控件配置与状态

  * 连接关系

  * 画布位置与缩放

  * 主题设置

* 工作流导入

* 工作流导出（JSON格式）

* 自动保存机制

***

### 阶段五：节点数据处理与执行

**目标**：实现节点间数据流与工作流执行引擎

#### 4.5.1 数据流机制

* 节点数据传输

* 数据类型转换

* 资源加载（图片、文件）

* 节点文本显示

* 控件数据与节点数据双向绑定

#### 4.5.2 执行引擎

* 拓扑排序确定执行顺序

* 节点并行/串行执行

* 执行状态追踪

* 错误处理与重试

* 执行日志

* 控件状态更新（Loading、Toast提示等）

* 节点执行时间显示（标题栏右上角）

#### 4.5.3 API集成

* 大模型API封装（OpenAI、Anthropic等）

* 生图API封装（Midjourney、Stable Diffusion等）

* 视频API封装

* API密钥管理

* 请求队列与限流

***

### 阶段六：用户体验优化

**目标**：完善交互体验与界面美化

#### 4.6.1 交互优化

* 节点拖拽流畅度

* 连接动画

* 快捷键支持

* 撤销/重做

* 画布迷你地图

* 控件交互反馈

* 节点右键菜单

#### 4.6.2 视觉优化

* 双主题完美适配

* 节点状态视觉反馈

* 执行进度动画

* 控件样式统一（深色/浅色）

* 节点标题栏状态指示器

* 平滑过渡动画

***

## 五、风险与应对

| 风险            | 影响 | 概率 | 应对措施               |
| ------------- | -- | -- | ------------------ |
| Vue Flow 学习曲线 | 中  | 高  | 先做PoC验证，参考官方示例     |
| 节点执行引擎复杂度     | 高  | 中  | 分阶段实现，先基础后高级       |
| 控件系统复杂度       | 中  | 中  | 先实现核心控件，逐步扩展       |
| 双主题适配复杂度      | 中  | 中  | 使用CSS变量，统一主题Token  |
| API调用稳定性      | 中  | 中  | 实现重试机制、错误边界        |
| 性能问题（大量节点）    | 中  | 低  | Vue Flow已优化，必要时虚拟化 |

***

## 六、开发顺序

1. **阶段一**：项目初始化 → 基础布局 → 双主题系统
2. **阶段二**：控件系统开发 → 基础控件实现 → 控件注册表 → 控件组合器
3. **阶段三**：Vue Flow集成 → 基础节点（含标题栏/端口/控件插槽） → 连接机制
4. **阶段四**：画布操作 → 右下角工具栏 → 多画布管理 → 持久化
5. **阶段五**：数据流 → 执行引擎 → API集成
6. **阶段六**：体验优化 → 测试 → 完善

***

## 七、文件清单（核心文件）

### 配置文件

* `package.json` - 项目依赖

* `vite.config.ts` - Vite配置

* `tailwind.config.ts` - Tailwind配置（含双主题Token）

* `tsconfig.json` - TypeScript配置

### 核心类型

* `src/types/node.ts` - 节点相关类型定义

* `src/types/workflow.ts` - 工作流类型定义

* `src/types/canvas.ts` - 画布类型定义

* `src/types/control.ts` - 控件类型定义

* `src/types/theme.ts` - 主题类型定义

### 控件系统

* `src/components/controls/registry.ts` - 控件注册表

* `src/features/controls/types.ts` - 控件功能类型

* `src/features/controls/composer.ts` - 控件组合器

* `src/composables/useControl.ts` - 控件Hook

### 主题系统

* `src/features/theme/dark.ts` - 深色主题配置

* `src/features/theme/light.ts` - 浅色主题配置

* `src/composables/useTheme.ts` - 主题Hook

### 状态管理

* `src/stores/app.ts` - 应用全局状态

* `src/stores/canvas.ts` - 画布状态

* `src/stores/workflow.ts` - 工作流状态

### 功能模块

* `src/features/nodes/registry.ts` - 节点注册表

* `src/features/workflow/engine.ts` - 工作流执行引擎

* `src/features/canvas/manager.ts` - 画布管理器

### UI组件

* `src/components/workspace/Workspace.vue` - 主工作区

* `src/components/canvas/CanvasView.vue` - 画布视图

* `src/components/canvas/CanvasToolbar.vue` - 右下角工具栏

* `src/components/nodes/BaseNode.vue` - 基础节点

* `src/components/nodes/NodeHeader.vue` - 节点标题栏

* `src/components/nodes/NodePort.vue` - 节点端口

* `src/components/nodes/NodeContent.vue` - 节点内容区

* `src/components/controls/*Control.vue` - 各控件组件

