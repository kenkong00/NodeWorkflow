# 自定义节点专用编辑器 Spec

## Why

当前「节点构建器」与草稿系统深度耦合，导致：
1. 从已发布节点加载编辑时需要复杂的 ID 判断和回退逻辑
2. 保存/发布逻辑分支过多，容易出错
3. 草稿和已发布节点的边界模糊，互相影响

用户需要一个**完全独立于草稿系统**的自定义节点编辑器。

## What Changes

### 新建独立编辑器

- **新增文件**：`src/components/tools/CustomNodeEditor.vue`
- **功能**：专门用于编辑已发布/自定义节点，与草稿系统完全分离
- **数据来源**：直接从 `node_published` 表读取，不经过草稿

### 编辑器特性

| 特性 | 说明 |
|------|------|
| **只读模式** | 初始加载已发布数据，用户修改后直接更新到已发布表 |
| **无草稿概念** | 不创建/不读取 `node_drafts` 表 |
| **保存方式** | 点击保存直接更新 `node_published` 表 |
| **发布方式** | 按钮变更为"更新"（已发布节点）或"发布"（可选新建） |

### 数据流向（简化）

```
已发布节点 → CustomNodeEditor 加载 → 用户修改 → 直接更新已发布表
                          ↓
                    node_published 表（UPDATE）
```

### 旧版 NodeBuilderEditor 用途变更

- **保留**新建节点时创建草稿的功能
- **移除**从已发布节点加载编辑的功能（改由 CustomNodeEditor 处理）

## Impact

- Affected specs: 节点管理系统、草稿分离
- Affected code:
  - 新建 `src/components/tools/CustomNodeEditor.vue`
  - 修改 `src/components/tools/NodeBuilderEditor.vue` - 移除已发布节点加载逻辑
  - 修改 `src/components/workspace/CustomNodeLibrary.vue` - "在构建器中编辑"指向新编辑器

## ADDED Requirements

### Requirement: 自定义节点专用编辑器

**系统 SHALL** 提供 CustomNodeEditor 组件，专门用于编辑已发布的自定义节点。

#### Scenario: 加载已发布节点
- **WHEN** 用户在 CustomNodeLibrary 中点击"在构建器中编辑"
- **THEN** 加载已发布节点的数据到编辑器
- **AND** 编辑器显示节点名称、图标、输入输出端口、控件配置

#### Scenario: 保存修改
- **WHEN** 用户修改节点后点击"保存"
- **THEN** 直接更新 `node_published` 表
- **AND** 显示保存成功提示
- **AND** 不影响 `node_drafts` 表

#### Scenario: 无草稿创建
- **WHEN** 用户在 CustomNodeEditor 中操作
- **THEN** 不读取 `node_drafts` 表
- **AND** 不创建任何草稿记录

## Technical Notes

### CustomNodeEditor 与 NodeBuilderEditor 的区别

| 功能 | NodeBuilderEditor | CustomNodeEditor |
|------|-------------------|------------------|
| 新建节点 | ✅ 创建草稿 | ❌ 不支持 |
| 编辑草稿 | ✅ | ❌ |
| 编辑已发布节点 | ⚠️ 复杂（有回退逻辑） | ✅ 简单直接 |
| 数据表 | node_drafts | node_published |
| 保存目标 | 草稿表 | 已发布表 |

### API 设计

```
GET  /api/published-nodes/:id      → 加载节点
PUT  /api/published-nodes/:id      → 保存修改
POST /api/published-nodes          → 发布新节点（可选）
```

### 组件结构

```
CustomNodeEditor.vue
├── 左侧面板：节点属性编辑（名称、图标、分类、描述）
├── 中间面板：节点预览（输入端口、控件、输出端口）
└── 右侧面板：端口/控件详情编辑
```
