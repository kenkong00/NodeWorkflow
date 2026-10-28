# Tasks

## 阶段一：新建 CustomNodeEditor 组件

- [ ] Task 1: 创建 CustomNodeEditor.vue 基础结构
  - [ ] 1.1 创建组件文件，复制 NodeBuilderEditor 的 UI 结构
  - [ ] 1.2 移除所有草稿相关逻辑（draftService、saveDraft、publishDraft）
  - [ ] 1.3 添加 publishedNodeService 导入
  - [ ] 1.4 实现简单的 session 状态（不含 sourceDraftId）

- [ ] Task 2: 实现数据加载
  - [ ] 2.1 从 URL 参数或 prop 接收 nodeId
  - [ ] 2.2 调用 publishedNodeService.findById() 加载数据
  - [ ] 2.3 填充 session 状态

- [ ] Task 3: 实现保存功能
  - [ ] 3.1 添加"保存"按钮
  - [ ] 3.2 调用 publishedNodeService.update() 直接更新
  - [ ] 3.3 显示保存结果提示

## 阶段二：修改 CustomNodeLibrary 链接新编辑器

- [ ] Task 4: 修改"在构建器中编辑"按钮
  - [ ] 4.1 移除 @openInBuilder 事件
  - [ ] 4.2 改为跳转到 CustomNodeEditor

- [ ] Task 5: 添加路由或参数传递
  - [ ] 5.1 通过 query 参数传递 nodeId
  - [ ] 5.2 或在 ToolsTab 中条件渲染 CustomNodeEditor

## 阶段三：清理旧代码

- [ ] Task 6: 简化 NodeBuilderEditor
  - [ ] 6.1 移除 sourcePublishedId 相关逻辑
  - [ ] 6.2 移除已发布节点加载回退逻辑
  - [ ] 6.3 保留纯草稿编辑功能

- [ ] Task 7: 更新类型定义
  - [ ] 7.1 从 NodeBuilderSession 移除 sourcePublishedId 字段

## Task Dependencies

- [Task 1] 是 [Task 2] 的前置条件
- [Task 2] 是 [Task 3] 的前置条件
- [Task 3, 4, 5] 可并行执行
- [Task 6] 依赖 [Task 3, 4, 5] 完成后进行
