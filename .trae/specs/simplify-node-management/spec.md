# 简化自定义节点管理 - 移除草稿功能 Spec

## Why

当前「草稿+发布」的双数据模型导致：
1. 同一个节点在两个表中有两份数据
2. 编辑时需要复杂的回退逻辑判断数据来源
3. 保存/发布逻辑分支过多，容易出错
4. 代码维护成本高

**重新思考**：节点构建不像写文章需要保存中间版本，节点是配置项，可以直接创建、修改、删除。

## What Changes

### 核心改动：移除草稿概念

- **删除 `node_drafts` 表及相关代码**
- **所有节点直接存储在 `node_published` 表**
- **创建 = 直接插入，修改 = 直接更新，删除 = 直接删除**

### 数据库变更

```
删除：
- node_drafts 表
- node_draft_control_instances 表
- DraftNodesRepo.ts
- DraftControlInstancesRepo.ts
- draftService.ts

保留：
- node_published 表
- node_published_control_instances 表
- PublishedNodesRepo.ts
- publishedNodeService.ts
```

### API 变更

```
旧：
POST   /api/drafts           → 创建草稿
PUT    /api/drafts/:id       → 更新草稿
PUT    /api/drafts/:id/publish → 发布草稿（复制到已发布）
DELETE /api/drafts/:id       → 删除草稿

新：
POST   /api/nodes            → 创建节点（直接插入）
GET    /api/nodes            → 获取所有节点
GET    /api/nodes/:id        → 获取单个节点
PUT    /api/nodes/:id        → 更新节点
DELETE /api/nodes/:id        → 删除节点
```

### 前端组件变更

```
删除：
- NodeBuilderEditor.vue（草稿编辑器）
- draftService.ts
- customNodesStore.ts（草稿相关逻辑）

修改：
- CustomNodeLibrary.vue → 直接使用 nodeService
- NodeLibraryManager.vue → 直接使用 nodeService
```

## Impact

- Affected specs: 节点管理系统
- Affected code:
  - 删除所有草稿相关代码
  - 简化数据流：节点只有一种状态

## ADDED Requirements

### Requirement: 节点直接管理

**系统 SHALL** 提供简单的节点管理功能，无需草稿概念。

#### Scenario: 创建节点
- **WHEN** 用户完成节点配置
- **THEN** 点击保存，节点直接存入数据库
- **AND** 可立即在节点库中看到并使用

#### Scenario: 编辑节点
- **WHEN** 用户选择已有节点进行编辑
- **THEN** 加载节点数据到编辑器
- **AND** 修改后直接保存更新

#### Scenario: 删除节点
- **WHEN** 用户删除节点
- **THEN** 节点从数据库永久移除
- **AND** 不存在"草稿还原"机制

## Technical Notes

### 新数据流

```
用户 → 创建/编辑节点 → 直接保存到 node_published 表 → 立即可用
```

### 优势

1. **代码量减少 50%+**：无需处理草稿/发布两种状态
2. **无数据同步问题**：一份数据，无须保持一致
3. **逻辑清晰**：CRUD 就是 CRUD，不需要判断来源
4. **调试简单**：数据流向单一

### 缺点

1. **无法"取消发布"**：但这对配置型节点意义不大
2. **无版本历史**：如需可后续添加审计日志

### 命名建议

| 旧名称 | 新名称 |
|--------|--------|
| draftService | nodeService |
| NodeBuilderEditor | NodeEditor |
| customNodesStore | nodeStore |
