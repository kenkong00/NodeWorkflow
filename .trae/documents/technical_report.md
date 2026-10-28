# 节点编辑工作流平台 - 技术报告总结

## 项目概述

本项目是一个基于 Vue 3 + TypeScript + Vue Flow 的节点编辑工作流平台，灵感来源于 ComfyUI。用户可以通过拖拽节点、连接节点来构建数据流工作流。

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **类型系统**: TypeScript
- **状态管理**: Pinia
- **节点编辑器**: @vue-flow/core
- **样式工具**: Tailwind CSS
- **图标库**: lucide-vue-next
- **构建工具**: Vite

## 已完成功能

### 1. 基础架构
- [x] 项目初始化与配置
- [x] 暗黑/亮色主题切换
- [x] 响应式布局设计
- [x] 多标签页支持

### 2. 节点系统（7种节点类型）
- [x] NumberInput（数字输入）— 控件级输入端口
- [x] Calculator（计算器）— 双控件级输入端口（A/B）
- [x] Display（数值显示）
- [x] TextInput（文本输入）— 控件级输入端口
- [x] TextDisplay（文本显示）
- [x] LoadImage（图片加载）
- [x] DisplayImage（图片显示）
- [x] 节点选中与删除（Delete/Backspace键）
- [x] 节点删除后自动重连（中间节点删除时保持数据流）
- [x] 节点大小调整（底部+右下角拖拽，右侧隐藏）

### 3. 连线系统
- [x] 拖拽创建连线
- [x] 数据类型兼容性检查（Number/String/Image/Boolean/Any）
- [x] 连线按数据类型动态着色（与端口颜色统一）
- [x] 连线删除（Shift+点击）
- [x] 自动重连逻辑（删除中间节点时）

### 4. 控件级输入端口系统 ⭐ 核心功能 (2026-04-19)
- [x] 每个输入控件的左侧有独立的方形输入端口（6px）
- [x] 未连接时：控件正常可编辑
- [x] 被连接后：控件变灰失效，值被外部输入取代
- [x] 显示外部值提示信息
- [x] 控件右侧无输出端口（输出统一从节点标题栏）
- [x] 控件级端口注册到 nodeRegistry 支持类型验证

### 5. 工作流功能
- [x] 工作流执行（数据传播，支持多迭代）
- [x] 执行日志显示
- [x] 画布缩放与平移
- [x] 重置视图
- [x] 保存/加载工作流（JSON格式，支持导入导出）

### 6. UI优化
- [x] 顶部工具栏整合（新建、保存、打开、主题切换、执行按钮等）
- [x] 节点运行状态高亮显示
- [x] 右侧 resize 手柄视觉隐藏（`visibility: hidden`）

### 7. 性能优化（2026-04-18）
- [x] 节点拖动 RAF 节流优化
- [x] 图片缓存系统（非响应式 Map 隔离大数据）
- [x] CSS Containment + GPU 加速
- [x] Vue Flow 渲染配置优化
- [x] 移除调试日志和修复控制台警告

---

## 关键技术实现

### 1. 性能优化：节点拖动节流

**问题**：Vue Flow 每帧触发 `onNodesChange`（~60fps），每次都调用 `triggerRef(nodes)` 导致所有节点重渲染，图片节点包含 base64 数据时严重卡顿。

**解决方案**：

```typescript
// CanvasView.vue - 核心优化代码
let isDragging = false;
let rafId: number | null = null;

const onNodesChange = (changes: any[]) => {
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      pendingPositionUpdates.set(change.id, change.position);
      arr[j].position = change.position;
    } else if (change.type === 'select') {
      isDragging = change.dragging ?? false;
    }
  }

  if (hasPositionChange) {
    if (isDragging) {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          triggerRef(nodes);
        });
      }
    } else {
      triggerRef(nodes);
      scheduleUpdateTab();
    }
  }
};
```

**效果**：从每帧多次重渲染降低到每帧1次，拖动流畅度显著提升。

---

### 2. 性能优化：图片缓存系统

**问题**：base64 图片数据（可能几MB）存储在节点响应式 `data` 中，任何节点拖动都会触发所有节点重渲染。

**解决方案**：创建非响应式缓存系统

```typescript
// src/utils/imageCache.ts
import { markRaw } from 'vue'

const imageCache = new Map<string, string>()  // 非 Vue 响应式

export function generateImageId(): string {
  return `img_${Date.now()}_${counter++}`
}

export function cacheImage(id: string, data: string): void {
  imageCache.set(id, data)
}

export function getCachedImage(id: string): string | undefined {
  return imageCache.get(id)
}
```

**数据对比**：
| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| `data.imageData` | `"data:image/jpeg;base64,/9j/4AAQ..."` (几MB) | `"img_1703xxx_1"` (20字节) |
| 重渲染开销 | 对比整个 base64 字符串 | 只对比短 ID |

---

### 3. 控件级输入端口系统 (2026-04-19) ⭐

**设计理念**：参考 ComfyUI 的节点设计，每个输入控件都有独立的输入端口，允许外部数据覆盖内部值。

**架构设计**：
```vue
<!-- NumberInputNode.vue 结构 -->
<BaseNode :inputs="[]" :outputs="numberOutputs">
  <div class="control-row">
    <!-- 控件级输入端口（方形，6px） -->
    <Handle type="target" id="value-input" class="control-port-input" />
    
    <!-- 输入控件（连接后变灰禁用） -->
    <InputControl v-model="numValue" :disabled="isControlConnected" />
    
    <!-- 注意：控件右侧无输出端口 -->
  </div>
</BaseNode>
```

**核心逻辑**：
```typescript
// 判断控件是否被外部连接覆盖
const isControlConnected = computed(() => {
  return isHandleConnected ? isHandleConnected(props.id!, 'value-input') : false
})

// 外部值变化时更新输出
watch(() => props.data?.externalValue, (newVal) => {
  if (nodeData.value && isControlConnected.value && newVal !== undefined) {
    nodeData.value.output = newVal  // 输出由外部决定
  }
})
```

**CSS 规范**：
```css
.control-port-input {
  width: 6px !important;       /* 缩小一半 */
  height: 6px !important;
  border-radius: 1px !important; /* 方形 */
  border: 1.5px solid #6b5563 !important;
  background: #4b5563 !important;
}
.control-port-input:hover {
  transform: scale(1.3);       /* 悬停放大 */
}
.control-disabled {
  opacity: 0.5;               /* 连接后变灰 */
  pointer-events: none;       /* 禁止交互 */
}
```

---

### 4. 数据类型颜色规范

| 数据类型 | 端口未连接 | 端口已连接 | **连线颜色** | 用途 |
|---------|-----------|-----------|------------|------|
| **Number** | `#93c5fd` 浅蓝 | `#3b82f6` **蓝色** | **`#60a5fa` 亮蓝** | 数字输入/计算器/数值显示 |
| **String** | `#fdba74` 浅橙 | `#f97316` **橙色** | **`#fb923c` 亮橙** | 文本输入/文本显示 |
| **Image** | `#86efac` 浅绿 | `#22c55e` **绿色** | **`#4ade80` 亮绿** | 图片加载/图片显示 |
| **Boolean** | `#fca5a5` 浅红 | `#ef4444` **红色** | **`#f87171` 亮红** | （预留） |
| **Any** | `#d8b4fe` 浅紫 | `#a855f7` **紫色** | **`#c084fc` 亮紫** | 文本显示 |

**关键规则**：端口颜色必须与连线颜色同色系！

---

### 5. 最终节点端口规范 (2026-04-19)

| 节点类型 | 类别 | 控件级输入 | 节点级输入 | 节点级输出 |
|---------|------|----------|----------|----------|
| **NumberInput** | 输入 | ✅ `value-input` (蓝色方形) | ❌ | ✅ `number` (蓝色圆形) |
| **Calculator** | 计算 | ✅ `num-a-input`, `num-b-input` (蓝色方形×2) | ❌ | ✅ `result` (蓝色圆形) |
| **Display** | 显示 | ❌ | ✅ `input` (蓝色圆形) | ❌ |
| **TextInput** | 输入 | ✅ `text-input` (橙色方形) | ❌ | ✅ `text` (橙色圆形) |
| **TextDisplay** | 显示 | ❌ | ✅ `input` (紫色圆形) | ❌ |
| **LoadImage** | 输入 | ❌ (预览区纯显示) | ❌ | ✅ `image` (绿色圆形) |
| **DisplayImage** | 显示 | ❌ | ✅ `input` (绿色圆形) | ❌ |

---

### 6. CSS GPU 加速优化

```css
/* BaseNode.vue - 节点卡片 */
.node-card {
  will-change: transform;
  contain: layout style paint;
}

/* style.css - 画布全局 */
.vue-flow__viewport {
  will-change: transform;
  contain: layout style paint;
}
```

---

### 7. Resize 手柄优化

```css
/* BaseNode.vue */
.resize-right {
  visibility: hidden;   /* 视觉隐藏但保留功能 */
}
/* 底部和右下角保持可见 */
.resize-bottom { /* 可见 */ }
.resize-corner { /* 可见 */ }
```

---

## 遇到的问题与解决方案

### 1. Delete键无法删除节点
**解决**: 使用 `useVueFlow` 的 `getSelectedNodes` 直接获取选中节点，在 `document` 上使用捕获阶段监听键盘事件。

### 2. 节点拖动卡顿（2026-04-18）
**解决**: RAF 节流 + 非响应式图片缓存 + CSS Containment

### 3. 控件级端口类型错误 (2026-04-19)
**问题**: `externalValue?.substring is not a function` — 数字类型传入文本节点调用字符串方法
**解决**: 添加安全类型转换 `displayExternalValue` 计算属性

### 4. 端口颜色不统一 (2026-04-19)
**问题**: DisplayNode 硬编码 `DataType.Any`（紫色），与数字连线的蓝色不一致
**解决**: 统一为 `DataType.Number`，确保端口和连线同色系

### 5. 控件级端口类型验证失效 (2026-04-19)
**问题**: 控件级端口未在 nodeRegistry 注册，导致 `getDataType()` 返回 Any
**解决**: 在 `nodes/index.ts` 中注册所有控件级端口的精确数据类型

---

## 文件结构

```
src/
├── components/
│   ├── canvas/
│   │   ├── CanvasView.vue          # 画布主组件（含 RAF 节流 + 数据传播）
│   │   ├── CanvasToolbar.vue       # 画布工具栏
│   │   └── WorkflowLog.vue         # 工作流日志
│   ├── nodes/
│   │   ├── BaseNode.vue            # 基础节点（GPU 加速 + resize 控制）
│   │   ├── PortHandle.vue          # 标准端口手柄组件
│   │   ├── NumberInputNode.vue     # 数字输入（控件级端口）
│   │   ├── CalculatorNode.vue      # 计算器（双控件级端口）
│   │   ├── DisplayNode.vue         # 数值显示
│   │   ├── TextInputNode.vue       # 文本输入（控件级端口）
│   │   ├── TextDisplayNode.vue     # 文本显示
│   │   ├── LoadImageNode.vue       # 图片加载（无控件级端口）
│   │   └── DisplayImageNode.vue    # 图片显示（仅节点级输入）
│   ├── controls/
│   │   ├── InputControl.vue        # 输入控件
│   │   ├── SelectControl.vue       # 选择控件
│   │   ├── TextAreaControl.vue     # 文本域控件
│   │   └── ImagePreview.vue        # 图片预览
│   └── workspace/
│       ├── Workspace.vue           # 工作区布局
│       ├── TopBar.vue              # 顶部工具栏
│       ├── TabBar.vue              # 标签页栏
│       ├── NodeLibrary.vue         # 节点库
│       └── SaveDialog.vue          # 保存对话框
├── utils/
│   └── imageCache.ts               # 图片缓存系统
├── config/
│   ├── nodes/index.ts              # 节点注册表（含控件级端口）
│   └── dataTypes.ts                # 数据类型定义
├── types/
│   ├── node.ts                     # 节点/端口/数据类型定义
│   └── control.ts                  # 控件类型定义
└── style.css                       # 全局样式
```

---

## 后续计划

### 高优先级 — ComfyUI 对接
- [ ] ComfyUI API 对接规划
- [ ] SD/SDXL 生图节点实现
- [ ] 工作流导出为 ComfyUI 格式

### 中优先级
- [ ] TypeScript 类型完善
- [ ] 撤销/重做功能（Undo/Redo）
- [ ] 节点复制/粘贴（Ctrl+C/V）
- [ ] 自动保存机制

### 低优先级
- [ ] 更多控件类型（开关、表格、颜色选择器等）
- [ ] 插件系统架构
- [ ] 协作编辑

---

## 总结

本项目成功实现了功能完善的节点编辑工作流平台。**2026-04-19 重点完成了控件级输入端口系统的设计与实现**，这是对接 ComfyUI 的关键技术基础：

1. **控件级输入端口**：每个控件有独立输入点，支持外部数据覆盖
2. **统一的颜色规范**：端口和连线严格按数据类型着色
3. **完整的类型验证**：所有端口注册到 nodeRegistry，防止类型不匹配连接
4. **规范的节点架构**：所有节点基于 BaseNode + PortHandle 组件构建

这些特性使得平台具备了与 ComfyUI 节点模型对齐的能力，为后续 AI 生图功能的集成奠定了坚实基础。

---

**报告日期**: 2026-04-18（初始）/ 2026-04-19（控件级端口系统）
**最后更新**: 2026-04-19
**开发人员**: AI Assistant
