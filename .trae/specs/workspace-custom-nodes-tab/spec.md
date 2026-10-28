# 工作台节点库添加自定义节点标签 Spec

## Why

当前项目存在**多套独立的数据源导致自定义节点显示不一致**的问题：

1. **NodeLibraryManager.vue（工具页-基础节点）**：通过 `nodeRegistry.getAll()` 加载节点，包含正确的自定义节点（在"★ 自定义"分类下），右侧编辑器能正确显示端口信息 ✅

2. **CustomNodeLibrary.vue（工具页-自定义节点导航）**：通过 `customNodeService.findAll()` 独立调用 API，**不经过 nodeRegistry**，导致端口数据解析异常、样式显示错误 ❌

3. **工作台侧边栏节点库（NodeLibrary.vue）**：数据源不明确，可能也存在类似问题

**根本原因**：项目架构应该是：
```
控件库 → 节点构建器组合 → 注册到 nodeRegistry → 节点库/工作台统一使用
```
但 CustomNodeLibrary.vue 绕过了 nodeRegistry，直接访问 API，破坏了统一性。

## What Changes

### 核心改动：在工作台节点库侧边栏添加"自定义节点"切换功能

- **修改文件**：`src/components/workspace/IconSidebar.vue` 或 `src/components/workspace/Workspace.vue`
- **新增功能**：在节点库面板顶部或侧边栏添加"自定义节点"按钮/标签
- **点击行为**：切换显示自定义节点列表（从 nodeRegistry 获取，而非独立 API）
- **拖拽支持**：自定义节点可以拖拽到画布使用，与基础节点行为一致

### 数据源统一

- **移除/重构 CustomNodeLibrary.vue 的独立数据源**
- **所有自定义节点显示都应基于 nodeRegistry.getCustomNodes() 或 nodeRegistry.getAll()**
- **确保端口数据、控件数据、样式配置的一致性**

## Impact

- Affected specs: 节点管理系统、工作台交互
- Affected code:
  - `src/components/workspace/IconSidebar.vue` - 侧边栏结构
  - `src/components/workspace/NodeLibrary.vue` - 工作台节点列表
  - `src/components/workspace/CustomNodeLibrary.vue` - 需要重构数据源
  - `src/components/tabs/ToolsTab.vue` - 导航结构（可选调整）

## ADDED Requirements

### Requirement: 工作台节点库自定义节点切换

**系统 SHALL** 在工作台左侧边栏的节点库面板中提供"自定义节点"视图切换功能。

#### Scenario: 切换到自定义节点视图
- **WHEN** 用户点击工作台节点库中的"自定义节点"按钮/标签
- **THEN** 系统显示所有已注册的自定义节点列表（从 nodeRegistry 获取）
- **AND** 每个节点正确显示：名称、图标、输入/输出端口指示器
- **AND** 节点可以拖拽到画布，行为与基础节点一致

#### Scenario: 自定义节点数据一致性
- **WHEN** 工作台显示自定义节点列表
- **THEN** 节点的端口数据、控件配置与「工具→基础节点→★ 自定义」分类下的完全一致
- **AND** 不存在独立的数据源或重复的 API 调用

### Requirement: 自定义节点拖拽兼容性

**系统 SHALL** 确保从工作台拖拽自定义节点到画布时，能正确创建节点实例。

#### Scenario: 拖拽自定义节点到画布
- **WHEN** 用户从工作台自定义节点列表拖拽一个节点到画布
- **THEN** 画布创建该节点的完整实例
- **AND** 实例包含正确的输入/输出端口、控件配置
- **AND** 实例渲染效果与节点构建器预览一致

## MODIFIED Requirements

### Requirement: CustomNodeLibrary.vue 数据源重构

**CustomNodeLibrary.vue SHALL** 使用 nodeRegistry 作为唯一数据源，而非直接调用 customNodeService API。

- **修改前**：`customNodeService.findAll()` → 独立 API 调用
- **修改后**：`nodeRegistry.getCustomNodes()` 或 `nodeRegistry.getAll().filter(n => n.isCustom)`
- **理由**：确保与基础节点、工作台节点库的数据一致性

## REMOVED Requirements

无

## Technical Notes

### 架构澄清

根据代码分析，正确的数据流应该是：

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────┐
│   控件库      │ ──→ │   节点构建器       │ ──→ │   nodeRegistry │
│ (ControlLib) │     │ (NodeBuilderEd)  │     │  (全局注册表)    │
└─────────────┘     └──────────────────┘     └────────────────┘
                                                           │
                           ┌────────────────────────────────┤
                           ↓                                ↓
                  ┌────────────────┐              ┌────────────────┐
                  │ 基础节点页面    │              │ 工作台节点库    │
                  │(NodeLibraryMgr)│              │ (Workspace)    │
                  │ nodeRegistry   │              │ nodeRegistry   │
                  │ .getAll()      │              │ .getCustom()   │
                  └────────────────┘              └────────────────┘
```

**当前问题**：CustomNodeLibrary.vue 直接调用 API，绕过了 nodeRegistry
