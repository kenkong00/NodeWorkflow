# 节点编辑工作流平台 - 规范化重构计划

> **状态**: ✅ 已完成（2026-04-19 更新最终规范）

---

## 一、已完成的重构内容

### ✅ 阶段一：数据类型系统重构

| 数据类型 | 枚举值 | 端口颜色 | 连线颜色 | 浅色版本 |
|---------|--------|---------|---------|---------|
| Number | `number` | `#3b82f6` | `#60a5fa` | `#93c5fd` |
| String | `string` | `#f97316` | `#fb923c` | `#fdba74` |
| Image | `image` | `#22c55e` | `#4ade80` | `#86efac` |
| Boolean | `boolean` | `#ef4444` | `#f87171` | `#fca5a5` |
| Any | `any` | `#a855f7` | `#c084fc` | `#d8b4fe` |

**文件**:
- [x] `src/types/node.ts` — DataType 枚举 + PortDefinition 接口
- [x] `src/config/dataTypes.ts` — 类型配置中心 + 兼容性检查
- [x] `src/components/nodes/PortHandle.vue` — 通用端口组件（按类型着色）

---

### ✅ 阶段二：节点架构规范化

**BaseNode 组件特性**:
- 声明式端口定义 (`:inputs` / `:outputs`)
- 自动渲染 PortHandle
- GPU 加速 (will-change + contain)
- Resize 控制（底部/右下角可见，右侧隐藏）
- 深色主题样式（ComfyUI 风格）

**NodeRegistry 注册机制**:
```typescript
// src/config/nodeRegistry.ts
class NodeRegistry {
  register(registration: NodeTypeRegistration): void
  get(type: string): NodeTypeRegistration | undefined
}
```

---

### ✅ 阶段三：控件库扩展

| 控件 | 文件路径 | 用途 |
|------|---------|------|
| InputControl | `controls/InputControl.vue` | 单行输入（number/text） |
| SelectControl | `controls/SelectControl.vue` | 下拉选择 |
| TextAreaControl | `controls/TextAreaControl.vue` | 多行文本 |
| ImagePreview | `controls/ImagePreview.vue` | 图片预览（含缓存优化） |

---

### ✅ 阶段四：新节点实现

全部 7 种节点已实现并规范化：

---

## 二、最终节点端口规范 ⭐ (2026-04-19)

### 核心设计原则

1. **控件级输入端口**：输入节点的每个控件左侧有独立方形输入点（6px）
2. **无控件级输出**：控件右侧不设输出点，输出统一从节点标题栏
3. **显示节点无控件级端口**：纯展示用途，只有节点级输入
4. **类型严格匹配**：所有端口注册到 nodeRegistry，连接时验证类型兼容性
5. **颜色统一规则**：端口和连线必须同色系

### 完整端口定义表

#### 输入类节点

| 节点 | 控件级输入 | 数据类型 | 节点级输出 | 数据类型 |
|-----|----------|---------|----------|---------|
| **NumberInput** | `value-input` | Number | `number` | Number |
| **TextInput** | `text-input` | String | `text` | String |
| **LoadImage** | ❌ (预览区纯显示) | - | `image` | Image |

#### 计算类节点

| 节点 | 控件级输入 | 数据类型 | 节点级输出 | 数据类型 |
|-----|----------|---------|----------|---------|
| **Calculator** | `num-a-input`, `num-b-input` | Number ×2 | `result` | Number |

#### 显示类节点

| 节点 | 节点级输入 | 数据类型 | 说明 |
|-----|----------|---------|------|
| **Display** | `input` | Number | 数值结果展示 |
| **TextDisplay** | `input` | Any | 文本结果展示 |
| **DisplayImage** | `input` | Image | 图片结果展示 |

### 视觉示例

```
输入节点（NumberInput）:
┌─────────────────────────────┐
│  🔢 数字输入 #1        [●] │  ← 节点级输出（圆形，蓝色）
├─────────────────────────────┤
│ ■ 0                        │  ← 控件级输入（方形，蓝色，6px）
│                             │     未连接时可编辑
│ 外部输入: -                 │     连接后变灰+提示
└─────────────────────────────┘


计算节点（Calculator）:
┌─────────────────────────────┐
│  🧮 计算器 #8          [●] │  ← 节点级输出（圆形，蓝色）
├─────────────────────────────┤
│ ■ A                        │  ← 控件级输入A（方形，蓝色）
│   [+ - × ÷]               │
│ ■ B                        │  ← 控件级输入B（方形，蓝色）
│ ┌─────────────────────┐    │
│ │ = 结果              │    │  ← 无端口
│ └─────────────────────┘    │
└─────────────────────────────┘


显示节点（Display）:
┌─────────────────────────────┐
│ ● 📊 数值显示 #2           │  ← 节点级输入（圆形，蓝色）
├─────────────────────────────┤
│   RESULT:                  │  ← 无控件级端口
│   ┌───────────┐            │
│   │    -      │            │
│   └───────────┘            │
└─────────────────────────────┘
```

### CSS 规范

```css
/* 控件级输入端口 */
.control-port-input {
  width: 6px !important;
  height: 6px !important;
  border-radius: 1px !important;       /* 方形 */
  border: 1.5px solid #6b5563 !important;
  background: #4b5563 !important;
}
.control-port-input:hover {
  transform: scale(1.3);
}

/* 连接后禁用状态 */
.control-disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* 右侧 resize 手柄隐藏 */
.resize-right {
  visibility: hidden;                   /* 功能保留，视觉隐藏 */
}
```

---

### ✅ 阶段五：画布逻辑更新

- [x] `getDataType()` 从硬编码改为查询 nodeRegistry
- [x] 连线按数据类型动态着色
- [x] `propagateData()` 支持控件级端口数据传播（externalValue 字段）
- [x] NodeLibrary 按类别分组显示

---

### ✅ 阶段六：样式优化

- [x] 连接点按数据类型着色（未连接浅色 / 已连接主色）
- [x] 连线与端口同色系
- [x] hover 放大 + 发光效果
- [x] 节点库分类折叠面板

---

## 三、nodeRegistry 完整注册表

```typescript
// src/config/nodes/index.ts 最终状态

nodeRegistry.register({
  type: 'numberInput',
  name: '数字输入',
  category: '输入',
  icon: '#️⃣',
  inputs: [
    { id: 'value-input', name: '值输入', dataType: DataType.Number, direction: 'input' }
  ],
  outputs: [
    { id: 'number', name: '数值', dataType: DataType.Number, direction: 'output' }
  ]
})

nodeRegistry.register({
  type: 'calculator',
  name: '计算器',
  category: '计算',
  icon: '🔢',
  inputs: [
    { id: 'num-a-input', name: 'A输入', dataType: DataType.Number, direction: 'input' },
    { id: 'num-b-input', name: 'B输入', dataType: DataType.Number, direction: 'input' }
  ],
  outputs: [
    { id: 'result', name: '结果', dataType: DataType.Number, direction: 'output' }
  ]
})

nodeRegistry.register({
  type: 'display',
  name: '数值显示',
  category: '显示',
  icon: '📊',
  inputs: [
    { id: 'input', name: '输入', dataType: DataType.Number, direction: 'input' }  // 注意：不是 Any！
  ],
  outputs: []
})

nodeRegistry.register({
  type: 'textInput',
  name: '文本输入',
  category: '输入',
  icon: '📝',
  inputs: [
    { id: 'text-input', name: '文本输入', dataType: DataType.String, direction: 'input' }
  ],
  outputs: [
    { id: 'text', name: '文本', dataType: DataType.String, direction: 'output' }
  ]
})

nodeRegistry.register({
  type: 'loadImage',
  name: '图片加载',
  category: '输入',
  icon: '🖼️',
  inputs: [],                                    // 无控件级/节点级输入
  outputs: [
    { id: 'image', name: '图片', dataType: DataType.Image, direction: 'output' }
  ]
})

// ... textDisplay, displayImage 同理
```

---

## 四、新增节点开发指南

### 步骤

1. **创建节点组件**（基于 BaseNode）
2. **在 nodeRegistry 注册**（定义 inputs/outputs 及其数据类型）
3. **在 NodeLibrary 显示**

### 模板

```vue
<template>
  <BaseNode v-bind="props" :inputs="myInputs" :outputs="myOutputs" icon="🎯">
    <div class="node-content">
      <!-- 控件区域 -->
    </div>
  </BaseNode>
</template>

<script setup lang="ts">
import { PortDefinition } from '@/types/node'
import { DataType } from '@/types/node'
import BaseNode from './BaseNode.vue'

const myInputs: PortDefinition[] = [
  // 控件级端口放在这里注册！
]

const myOutputs: PortDefinition[] = [
  // 节点级输出端口
]
</script>
```

---

## 五、后续规划

### 下一步：ComfyUI 对接
- [ ] ComfyUI API 对接架构设计
- [ ] SD/SDXL 生图节点实现
- [ ] 工作流格式转换（JSON → ComfyUI API 格式）

### 其他待办
- [ ] TypeScript 类型完善
- [ ] Undo/Redo 功能
- [ ] Ctrl+C/V 复制粘贴
- [ ] 自动保存

---

**最后更新**: 2026-04-19（控件级端口系统 + 最终规范确认）
