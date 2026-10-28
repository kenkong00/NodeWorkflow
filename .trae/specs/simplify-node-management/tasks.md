# Tasks

## 阶段一：数据库重构

- [x] Task 1: 修改 init.sql
  - [x] 1.1 重命名 `node_published` 为 `nodes`（或保留）
  - [x] 1.2 删除 `node_drafts` 表
  - [x] 1.3 重命名 `node_published_control_instances` 为 `node_control_instances`

- [x] Task 2: 创建数据库迁移脚本
  - [x] 2.1 将 `node_published` 数据迁移到 `nodes` 表
  - [x] 2.2 将 `node_published_control_instances` 迁移到 `node_control_instances`
  - [x] 2.3 删除旧表

## 阶段二：后端代码重构

- [x] Task 3: 创建 NodesRepo.ts（合并版）
  - [x] 3.1 基本 CRUD 操作
  - [x] 3.2 移除 status 字段判断
  - [x] 3.3 移除 publish 相关逻辑

- [x] Task 4: 更新 vite.config.ts API 路由
  - [x] 4.1 移除 `/api/drafts` 路由
  - [x] 4.2 移除 `/api/drafts/:id/publish` 路由
  - [x] 4.3 添加 `/api/nodes` CRUD 路由

## 阶段三：前端代码重构

- [x] Task 5: 创建 nodeService.ts
  - [x] 5.1 基本 CRUD API 调用
  - [x] 5.2 移除 publish 相关方法
  - [x] 5.3 移除 status 字段

- [x] Task 6: 创建 nodeStore.ts
  - [x] 6.1 简化状态管理
  - [x] 6.2 移除 draftNodes、publishedNodes 区分
  - [x] 6.3 只保留 nodes 列表

- [x] Task 7: 重构/简化 NodeBuilderEditor.vue
  - [x] 7.1 移除草稿相关逻辑
  - [x] 7.2 直接使用 nodeService 保存

- [x] Task 8: 更新 CustomNodeLibrary.vue
  - [x] 8.1 使用 nodeService 替代旧服务
  - [x] 8.2 移除草稿/发布状态显示

- [x] Task 9: 更新 NodeLibraryManager.vue
  - [x] 9.1 使用 nodeService 替代旧服务
  - [x] 9.2 简化节点管理逻辑

## 阶段四：清理

- [x] Task 10: 删除废弃文件
  - [x] 10.1 删除 draftService.ts
  - [x] 10.2 删除 DraftNodesRepo.ts
  - [x] 10.3 删除 DraftControlInstancesRepo.ts
  - [x] 10.4 删除 customNodesStore.ts
  - [x] 10.5 删除 PublishedNodesRepo.ts
  - [x] 10.6 删除 PublishedControlInstancesRepo.ts

- [x] Task 11: 更新 nodeRegistry.ts
  - [x] 11.1 从 `/api/nodes` 加载数据
  - [x] 11.2 移除 publish 相关逻辑

## Task Dependencies

- [Task 1, 2] 是其他任务的前置条件
- [Task 3, 4] 可并行
- [Task 5, 6] 可并行
- [Task 7] 依赖 [Task 5, 6]
- [Task 8, 9] 可并行，依赖 [Task 5, 6]
- [Task 10, 11] 在所有其他任务后执行
