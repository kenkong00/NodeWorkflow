# 节点样式统一修复计划 — 控件库 & 样式库 & 端口显示链路

## 问题总览

用户反馈了4个关联问题，核心是 **控件库 → 节点构造器 → 工作台节点** 这条数据链路上的**端口配置和样式传递断裂**。

---

## 问题1：控件名称可编辑 + 名称显隐控制

**现状**：
- [ControlLibrary.vue](src/components/tools/ControlLibrary.vue) 中 `editingName` 变量已声明但未绑定到任何 `<input>`
- 只有非系统控件才能编辑名称，系统控件（isSystem=true）不应允许改名
- 没有名称显示/隐藏的控制机制

**修复方案**：

### 1.1 控件名称编辑功能
**文件**: `src/components/tools/ControlLibrary.vue`

- 在右侧编辑面板的 `editor-header` 区域，将静态的 `<h3 class="editor-title">` 替换为可编辑的 `<input>`（仅非系统控件）
- 绑定 `v-model="editingName"` 到该 input
- 保存时通过 `store.updateControl()` 写入 `displayName`

### 1.2 名称显隐控制
**文件**: `src/types/control.types.ts`

- 在 `ControlDefinition` 接口中新增字段：
  ```ts
  showLabel?: boolean  // 是否显示控件标签名称，默认 true
  ```
- 在 `ControlLibrary.vue` 右侧面板的端口配置区域上方新增"显示设置"区块：
  - 复选框：「显示控件名称」(v-model="showLabel")
- 保存时一并写入

---

## 问题2：端口配置默认勾选 + 默认方形端口样式 + 样式库联动

**现状**：
- [ControlLibrary.vue:317](src/components/tools/ControlLibrary.vue#L317): `hasInputPort = ref(false)` — 默认关闭
- [ControlLibrary.vue:163-168](src/components/tools/ControlLibrary.vue#L163-L168): 有端口样式选择器，但选择结果仅存入 `styleRefs.portStyleId`，**从未被实际消费**
- [PortHandle.vue:92-100](src/components/nodes/PortHandle.vue#L92-L100): 端口样式硬编码为圆形 `border-radius: 50% !important`，完全不读样式库

**修复方案**：

### 2.1 端口配置默认开启
**文件**: `src/components/tools/ControlLibrary.vue`

- 将 `hasInputPort` 初始值改为 `true`
- 将 `inputPortName` 初始值改为空字符串 `''`（外部输入不需要显示端口名）
- 新增 `showPortName` 开关（默认 false），控制是否显示输入端口的名称文字

### 2.2 默认端口样式改为方形
**文件**: `src/components/tools/ControlLibrary.vue`

- 在 `selectControl()` 和 watch 中，当控件的 `portConfig?.hasInputPort === undefined` 时，默认设为 `true`
- 当 `selectedPortStyleId` 为空且 `hasInputPort` 为 true 时，自动选中样式库中 shape='square' 的预设（或第一个port样式）

### 2.3 PortHandle 组件消费样式库端口样式（关键修复）
**文件**: `src/components/nodes/PortHandle.vue`

这是最核心的修复——让 PortHandle 能够根据传入的样式配置动态渲染形状。

- 新增 Props:
  ```ts
  interface Props {
    // ... 现有 props
    portStyleConfig?: PortStyleConfig | null  // 新增
  }
  ```

- 修改 `handleStyle` computed，根据 `portStyleConfig` 动态计算样式：
  ```ts
  const handleStyle = computed(() => {
    const baseColor = color.value
    const style = props.portStyleConfig

    const shapeMap: Record<string, string> = {
      circle: '50%',
      square: '2px',
      diamond: '50%'
    }

    return {
      backgroundColor: _connected.value ? baseColor : 'transparent',
      borderColor: baseColor,
      borderRadius: style?.shape ? (shapeMap[style.shape] || '50%') : '50%',
      width: `${style?.size || 8}px`,
      height: `${style?.size || 8}px`,
      borderWidth: `${style?.borderWidth || 2}px`,
    }
  })
  ```

### 2.4 BaseNode 向 PortHandle 传递端口样式
**文件**: `src/components/nodes/BaseNode.vue`

- BaseNode 需要接收节点级别的 `portStyleConfig`（从 data 或 inject 获取）
- 将其传递给子组件 PortHandle:
  ```vue
  <PortHandle
    ...
    :port-style-config="nodePortStyleConfig"
  />
  ```

### 2.5 CustomNodeRenderer 传递样式到 BaseNode
**文件**: `src/components/nodes/CustomNodeRenderer.vue`

- 从 `props.data.styleRefs?.portId` 或全局 store 获取端口样式ID
- 通过 stylePresetsStore.getPortStyleConfig() 获取具体配置
- 传递给 BaseNode

---

## 问题3：节点构造器中拖入控件后不显示端口（核心Bug）

**根因分析**：

数据流断裂点在 [NodeBuilderEditor.addControl()](src/components/tools/NodeBuilderEditor.vue#L855-L868)：

```ts
function addControl(control: ControlDefinition) {
  const instance = {
    controlType: control.controlType,
    bindToPort: undefined,
    label: control.displayName,
    position: 'body',
    orderIndex: session.controls.length,
    config: {},
    styleOverrides: {}
    // ⚠️ 缺失: portConfig / hasInputPort 信息没有传递过来！
  }
}
```

同时预览区域 [NodeBuilderEditor.vue:211-227](src/components/tools/NodeBuilderEditor.vue#L211-L227) 渲染控件时，**完全没有为每个控件渲染左侧输入端口**。

**修复方案**：

### 3.1 addControl 携带端口配置
**文件**: `src/components/tools/NodeBuilderEditor.vue`

```ts
function addControl(control: ControlDefinition) {
  const instance: Omit<ControlInstance, 'id' | 'nodeId'> = {
    controlType: control.controlType,
    bindToPort: undefined,
    label: control.displayName,
    position: 'body',
    orderIndex: session.controls.length,
    config: {},
    styleOverrides: {},
    // 新增：携带控件的端口配置
    hasInputPort: control.portConfig?.hasInputPort ?? true,   // 默认有端口
    inputPortDataType: control.portConfig?.inputPortDataType || 'ANY',
    inputPortName: control.portConfig?.inputPortName || '',
    showLabel: control.showLabel ?? true,                      // 名称显隐
    portStyleId: control.styleRefs?.portStyleId || '',         // 端口样式引用
  }
}
```

### 3.2 ControlInstance 类型扩展
**文件**: `src/types/nodeBuilder.types.ts`

```ts
export interface ControlInstance {
  // ... 现有字段
  hasInputPort?: boolean          // 新增
  inputPortDataType?: string      // 新增
  inputPortName?: string          // 新增
  showLabel?: boolean             // 新增
  portStyleId?: string            // 新增
}
```

### 3.3 预览区为每个控件渲染左侧端口
**文件**: `src/components/tools/NodeBuilderEditor.vue` — preview-controls 区域

将现有的简单控件渲染：
```vue
<component v-for="(ctrl, idx) in session.controls" :is="..." :label="ctrl.label" />
```

改为带端口的行布局：
```vue
<div v-for="(ctrl, idx) in session.controls" :key="'ctrl-' + idx" class="preview-control-row">
  <!-- 左侧输入端口 -->
  <div v-if="ctrl.hasInputPort" class="preview-control-port">
    <span class="preview-port-dot" :style="getControlPortStyle(ctrl)" />
  </div>
  <!-- 控件本体 -->
  <div class="preview-control-body">
    <label v-if="ctrl.showLabel !== false" class="preview-control-label">{{ ctrl.label }}</label>
    <component :is="getControlComponent(ctrl.controlType)" ... />
  </div>
</div>
```

### 3.4 已添加控件列表支持端口配置
**文件**: `src/components/tools/NodeBuilderEditor.vue` — added-controls 区域

在每个已添加控件的 item-right 区域新增：
- 端口开关 toggle（启用/禁用输入端口）
- 端口名称输入（可选）

---

## 问题4：工作台节点样式偏差

**根因**：
- [CustomNodeRenderer.vue](src/components/nodes/CustomNodeRenderer.vue) 渲染自定义节点时，没有应用节点样式和端口样式
- BaseNode 的样式是硬编码的 CSS 变量，没有根据 styleRefs 动态调整

**修复方案**：

### 4.1 CustomNodeRenderer 注入样式配置
**文件**: `src/components/nodes/CustomNodeRenderer.vue`

- 从 `props.data` 中提取 `styleRefs`（包含 nodeId, portId, controlId）
- 使用 `useStylePresetsStore()` 获取各样式配置
- 计算并传递给 BaseNode 和控件

### 4.2 BaseNode 支持动态样式覆盖
**文件**: `src/components/nodes/BaseNode.vue`

- 新增 prop `nodeStyleConfig?: NodeStyleConfig`
- 在 `cardStyle` computed 中合并节点样式配置（背景色、边框、圆角等）
- 将 portStyleConfig 传递给所有子 PortHandle

### 4.3 注册自定义节点时的样式传递
**文件**: `src/config/nodeRegistry.ts` 或相关注册逻辑

确保发布/保存节点时，`styleRefs` 信息被正确序列化到节点数据中，使得 CustomNodeRenderer 能够读取。

---

## 实施顺序（依赖关系）

```
Step 1: 类型定义扩展
  ├── 1.1 control.types.ts — 新增 showLabel 字段
  ├── 1.2 nodeBuilder.types.ts — ControlInstance 新增端口相关字段
  └── 1.3 node.ts — 如需扩展 PortDefinition

Step 2: 控件库编辑能力完善
  ├── 2.1 ControlLibrary.vue — 名称编辑 input + 显隐开关
  ├── 2.2 ControlLibrary.vue — 端口配置默认值修正（hasInputPort=true）
  └── 2.3 ControlLibrary.vue — 保存逻辑补充新字段

Step 3: PortHandle 样式动态化（核心）
  ├── 3.1 PortHandle.vue — 接收 portStyleConfig prop
  ├── 3.2 PortHandle.vue — handleStyle 根据 config 动态计算
  └── 3.3 PortHandle.vue — 支持方形/圆形/菱形切换

Step 4: 节点构造器端口显示修复
  ├── 4.1 NodeBuilderEditor.vue — addControl() 携带 portConfig
  ├── 4.2 NodeBuilderEditor.vue — 预览区渲染控件级端口
  └── 4.3 NodeBuilderEditor.vue — 已添加控件列表支持端口配置UI

Step 5: BaseNode 样式传递链路
  ├── 5.1 BaseNode.vue — 接收并应用 nodeStyleConfig
  ├── 5.2 BaseNode.vue — 向 PortHandle 传递 portStyleConfig
  └── 5.3 BaseNode.vue — cardStyle 合并动态样式

Step 6: CustomNodeRenderer 完整链路
  ├── 6.1 CustomNodeRenderer.vue — 读取 styleRefs 并获取样式配置
  ├── 6.2 CustomNodeRenderer.vue — 传递给 BaseNode
  └── 6.3 CustomNodeRenderer.vue — 控件级端口渲染（如需要）

Step 7: 端到端验证
  └── 7.1 全链路测试：控件库配置 → 构造器预览 → 发布 → 工作台使用
```

---

## 关键文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/types/control.types.ts` | 修改 | ControlDefinition 新增 showLabel |
| `src/types/nodeBuilder.types.ts` | 修改 | ControlInstance 新增端口字段 |
| `src/components/tools/ControlLibrary.vue` | 修改 | 名称编辑+显隐+端口默认值 |
| `src/components/nodes/PortHandle.vue` | 修改 | 动态端口样式（核心） |
| `src/components/nodes/BaseNode.vue` | 修改 | 样式传递链路 |
| `src/components/tools/NodeBuilderEditor.vue` | 修改 | addControl+预览端口+控件列表 |
| `src/components/nodes/CustomNodeRenderer.vue` | 修改 | 样式注入 |

---

## 风险点

1. **向后兼容**：已有节点的数据可能缺少新字段，需做好默认值 fallback
2. **CSS 优先级**：PortHandle 当前用了 `!important`，动态样式需确保优先级足够
3. **性能**：每个 PortHandle 都查询样式配置，注意缓存或通过 provide/inject 批量传递
