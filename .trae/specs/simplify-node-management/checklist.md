# Checklist

## 数据库

- [x] `node_drafts` 表已删除
- [x] `node_published` 表已重命名为 `nodes` 或保留
- [x] `node_published_control_instances` 已重命名
- [x] 数据库迁移成功，旧数据可用

## 后端 API

- [x] `/api/drafts` 路由已移除
- [x] `/api/drafts/:id/publish` 路由已移除
- [x] `/api/nodes` CRUD 路由已添加
- [x] NodesRepo.ts 实现完整 CRUD

## 前端 Services

- [x] nodeService.ts 创建完成
- [x] 基本 CRUD API 调用正常
- [x] 无 publish 相关方法

## 前端 Stores

- [x] nodeStore.ts 创建完成
- [x] nodes 列表管理正常
- [x] 无 draft/published 区分

## 前端组件

- [x] NodeBuilderEditor.vue 简化完成
- [x] CustomNodeLibrary.vue 使用 nodeService
- [x] NodeLibraryManager.vue 使用 nodeService
- [x] nodeRegistry.ts 使用 /api/nodes

## 废弃文件清理

- [x] draftService.ts 已删除
- [x] DraftNodesRepo.ts 已删除
- [x] DraftControlInstancesRepo.ts 已删除
- [x] PublishedNodesRepo.ts 已删除
- [x] PublishedControlInstancesRepo.ts 已删除
- [x] customNodesStore.ts 已删除
- [x] publishedNodeService.ts 已删除

## 功能验证

- [ ] 可以创建新节点
- [ ] 可以编辑已有节点
- [ ] 可以删除节点
- [ ] 节点列表正确显示
- [ ] 节点可拖拽到画布使用
