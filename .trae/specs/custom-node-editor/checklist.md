# Checklist

## CustomNodeEditor 组件

- [ ] CustomNodeEditor.vue 文件已创建
- [ ] 组件结构与 NodeBuilderEditor.vue 类似
- [ ] 无草稿相关代码（draftService 导入已移除）
- [ ] 使用 publishedNodeService 作为数据源
- [ ] session 状态正确初始化

## 数据加载

- [ ] 加载已发布节点数据到编辑器
- [ ] 节点名称、图标、分类、描述正确显示
- [ ] 输入/输出端口正确加载
- [ ] 控件配置正确加载

## 保存功能

- [ ] "保存"按钮存在且可点击
- [ ] 点击保存调用 publishedNodeService.update()
- [ ] 保存成功显示提示
- [ ] 保存后数据反映在已发布节点列表

## 与 CustomNodeLibrary 集成

- [ ] CustomNodeLibrary 中的"在构建器中编辑"按钮触发新编辑器
- [ ] 节点 ID 正确传递到 CustomNodeEditor

## 旧代码清理

- [ ] NodeBuilderEditor 中的 sourcePublishedId 逻辑已移除
- [ ] 已发布节点加载回退逻辑已移除
- [ ] NodeBuilderSession 类型已更新
