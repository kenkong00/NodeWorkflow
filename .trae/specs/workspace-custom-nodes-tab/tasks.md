# Tasks

## 阶段一：理解与验证（当前）

- [x] Task 1: 分析项目节点数据流架构
  - [x] 1.1 确认 NodeLibraryManager.vue 的数据源（nodeRegistry）
  - [x] 1.2 确认 CustomNodeLibrary.vue 的数据源（customNodeService - 问题所在）
  - [x] 1.3 确认工作台侧边栏的当前实现方式

## 阶段二：核心功能实现

- [x] Task 2: 重构 CustomNodeLibrary.vue 数据源
  - [x] 2.1 移除 customNodeService.findAll() 的直接调用
  - [x] 2.2 改用 nodeRegistry.getCustomNodes() 或 nodeRegistry.getAll().filter(n => n.isCustom)
  - [x] 2.3 确保端口解析逻辑与 nodeRegistry.loadCustomNodesFromAPI() 一致
  - [x] 2.4 测试验证：工具页"自定义节点"导航显示正确的节点列表和端口

- [x] Task 3: 工作台侧边栏添加自定义节点切换功能
  - [x] 3.1 分析 IconSidebar.vue 和 Workspace.vue 的当前结构
  - [x] 3.2 在节点库面板添加"自定义节点"按钮/标签（建议位置：搜索框下方或分类标题旁）
  - [x] 3.3 实现视图切换状态管理（基础节点 vs 自定义节点）
  - [x] 3.4 复用 NodeLibrary.vue 组件或创建 CustomNodePanel 子组件
  - [x] 3.5 确保自定义节点列表从 nodeRegistry 获取数据

- [x] Task 4: 实现拖拽兼容性
  - [x] 4.1 确认工作台节点库的 dragstart 事件处理
  - [x] 4.2 验证自定义节点拖拽时传递的数据结构包含完整信息（type, name, inputs, outputs, controls）
  - [x] 4.3 测试：从工作台拖拽自定义节点到画布，检查节点实例是否正确渲染

- [x] Task 5: 清理冗余代码
  - [x] 5.1 检查是否可以移除 CustomNodeLibrary.vue 中的独立 API 调用代码
  - [x] 5.2 统一端口解析函数（避免 parsePorts 重复实现）
  - [x] 5.3 移除不必要的调试日志（如果有的话）

- [x] Task 6: 最终测试验证
  - [x] 6.1 验证三个位置的自定义节点显示一致：
    - 工具页「基础节点」→ ★ 自定义 分类
    - 工作台侧边栏 → 自定义节点标签页
    - （可选）工具页「自定义节点」导航（如果保留）
  - [x] 6.2 验证所有位置的拖拽功能正常
  - [x] 6.3 验证端口指示器、控件配置、样式应用一致

# Task Dependencies

- [Task 2] 应优先完成，为 Task 3 提供统一的数据源基础
- [Task 3] 依赖 [Task 2] 完成后才能确保数据显示正确
- [Task 4] 依赖 [Task 3] 完成 UI 后才能测试拖拽
- [Task 5] 可在 [Task 2-4] 完成后并行执行
- [Task 6] 必须在所有其他任务完成后执行
