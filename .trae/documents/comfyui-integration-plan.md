# ComfyUI 对接功能 — 技术规范文档

> **状态**: ✅ 核心功能已完成并验证通过
> **最后更新**: 2026-04-20

---

## 📋 功能概述

为节点编辑工作流平台添加完整的 **ComfyUI 对接功能**，包括：

| 功能 | 状态 | 说明 |
|------|------|------|
| 左侧 ComfyUI 配置面板 | ✅ | 持久化到 JSON 文件（Vite API 中间件） |
| 左侧工作流编辑面板 | ✅ | 导入/导出/选择/验证 |
| ComfyUI 连通节点 | ✅ | 自动心跳检测、输出连接状态 |
| 工作流加载节点 | ✅ | 加载/选择/导入工作流 JSON |
| 单图生成节点（核心） | ✅ | 2特殊端口+4控件端口，WebSocket精确进度 |
| 执行按钮总控 | ✅ | 串行执行所有单图节点 + 绿色边框 |
| 图片输出到 DisplayImageNode | ✅ | blob URL 方式绕过 CORS |

---

## 🏗️ 最终架构

### 数据流架构

```
┌───────────────────────────────────────────────────────────────┐
│                      左侧状态栏                                │
├──────────┬──────────────────┬────────────────────────────────┤
│  📁 文件 │  ⚙️ ComfyUI配置   │  📋 工作流API编辑               │
│          │                  │                                │
│          │  URL / 超时       │  选择 / 导入 / 导出            │
│          │  测试连接 / 保存   │  JSON 编辑器                   │
└──────────┴──────────────────┴────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                        画布节点                                 │
├──────────┬──────────────────┬────────────────────────────────┤
│ 🟢 连接  │  📄 工作流加载    │  🎨 单图生成                    │
│          │                  │                                │
│ ──[连接]─▶│ ──[工作流]────▶│ ○连接 ○工作流                    │
│          │                  │ 提示词 宽 高 数量                │
│          │                  │ [🚀 开始生成]                    │
│          │                  │ ──[图片]────▶ 🖼️ 显示           │
└──────────┴──────────────────┴────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   ComfyUI API   │
                    │ ws://...:8188   │
                    │ (WebSocket进度) │
                    └─────────────────┘
```

### 双层执行模式

```
┌─────────────────────────────────────────────────────────────┐
│  ▶ 执行（工具栏总开关）                                       │
│  ├── 1. propagateData()     传播连线数据                       │
│  ├── 2. triggerAllGenerators() 串行触发每个单图节点             │
│  │   ├── 单图 #1 → 绿色边框 → 生成中 3/9 → 完成 → 边框消失    │
│  │   ├── 单图 #2 → 绿色边框 → 生成中 3/9 → 完成 → 边框消失    │
│  │   └── ...                                                  │
│  └── 3. 全部完成                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  🚀 开始生成（单个节点内按钮）                                  │
│  └── 只跑这一个节点：读上游数据 → 注入参数 → WS进度 → 取结果    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 端口架构（单图生成节点）

### 最终端口布局

```
┌──────────────────────────────────────────┐
│  🎨 单图生成  #1              ● [图片输出] │  ← BaseNode标题栏
├──────────────────────────────────────────┤
│  ●连接(绿)   ○工作流(橙)    ← 2个圆形特殊端口 │  ← special-ports-row
│──────────────────────────────────────────│
│  ✓ 已连接 ComfyUI                        │  ← connection-status
│                                           │
│  提示词                                   │
│  □ [textarea....................]         │  ← 方形控件端口 + 控件
│                                           │
│  宽度                                     │
│  □ [1024........................]        │
│                                           │
│  高度                                     │
│  □ [1024........................]        │
│                                           │
│  数量                                     │
│  □ [1..........................]         │
│                                           │
│     [🚀 准备就绪] / [生成中... 5/9]      │
│  ════════════════════════════ 进度条       │
└──────────────────────────────────────────┘
```

### 端口清单（6个输入 + 1个输出）

| ID | 类型 | 形状 | 用途 | 数据类型 |
|----|------|------|------|----------|
| `connection-input` | 特殊 | 圆形14px | ComfyUI连接 | ComfyUIConnection |
| `workflow-input` | 特殊 | 圆形14px | 工作流数据 | WorkflowAPI |
| `prompt-input` | 控件 | 方形8px | 提示词覆盖 | String |
| `width-input` | 控件 | 方形8px | 宽度覆盖 | Number |
| `height-input` | 控件 | 方形8px | 高度覆盖 | Number |
| `batch-input` | 控件 | 方形8px | 数量覆盖 | Number |
| `image-output` | 输出 | 默认 | 生成图片 | Image |

**关键技术决策**: 使用 `:inputs="[]"` 让 BaseNode 不自动渲染输入端口，6个端口全部手动 `<Handle>` 放置。参考 NumberInputNode 的成功模式。

---

## 🔑 关键技术决策记录

### 决策 1: 持久化方案 — Vite API 中中间件 + JSON 文件

| 方案 | 选择 | 原因 |
|------|------|------|
| localStorage | ❌ | 跨浏览器不一致，迁移数据库困难 |
| IndexedDB | ❌ | 复杂度高，调试不便 |
| **Vite 中间件 + JSON** | ✅ | 跨浏览器一致、Git可管理、未来易迁移 |

**API 端点**:
- `GET/POST /api/config` ↔ `public/comfyui-config.json`
- `GET/POST /api/workflow` ↔ `public/workflow-api.json`

### 决策 2: Backspace 键不删除节点

**文件**: CanvasView.vue — 键盘事件处理

```js
// 修改前: event.key === 'Delete' || event.key === 'Backspace'
// 修改后: event.key === 'Delete'  （只允许 Delete 键删除）
```

原因：文本控件内按 Backspace 删除文字时不应该误删整个节点。

### 决策 3: 上游数据实时读取（getUpstreamNodeData）

**问题**: 点击"开始生成"时需要最新数据，但"执行"按钮的 propagateData 可能还没运行过。

**方案**: 在 CanvasView 中注入 `getUpstreamNodeData(nodeId, handleId)` 函数：
```js
const getUpstreamNodeData = (nodeId, handleId) => {
  const edge = edges.value.find(e => e.target === nodeId && e.targetHandle === handleId)
  const sourceNode = nodes.value.find(n => n.id === edge.source)
  return sourceNode?.data ?? null  // 直接从内存读取实时数据
}
```

单图节点的 `getConnectionStatus()` 和 `getWorkflowData()` 都用这个函数。

### 决策 4: 图片输出 — blob URL 绕过 CORS

**问题链**:
1. ComfyUI 返回图片 URL: `http://127.0.0.1:8188/view?filename=xxx.png`
2. 浏览器在 `<img src="...">` 中加载此 URL → **CORS 拦截**
3. 尝试走 `/comfyui-proxy` 代理 → 代理请求也可能失败

**最终方案**: 服务端 fetch → blob URL

```js
// extractImages 中:
const imgRes = await fetch(imgUrl)        // Vite dev server 发起（无CORS）
const blob = await imgRes.blob()
const blobUrl = URL.createObjectURL(blob) // blob:http://localhost:5173/xxx
images.push({ url: blobUrl })             // 同源！浏览器可直接加载
```

### 决策 5: updateNodeDataById 必须创建新对象引用

**问题**: `nodes` 是 `shallowRef`，`Object.assign(node.data, newData)` 不触发深层响应式更新。

**修复**:
```js
nodes.value[idx] = { ...node, data: { ...node.data, ...newData } }
nodes.value = [...nodes.value]  // 触发 shallowRef 更新
```

### 决策 6: WebSocket 精确步数进度

**问题**: 时间估算不可靠（本地40s vs 云端5s），/queue API extras 字段不稳定。

**方案**: ComfyUI WebSocket 实时推送

```
连接: ws://{comfyui_url}/ws?clientId={uuid}
消息: { type: "progress", data: { value: 4, max: 9, node: "138" } }
显示: "生成中... 4/9"
完成: { type: "status", data: { status_str: "success" } }
```

**双轨保险**: WebSocket 主力 + /history 每2秒轮询 fallback。

### 决策 7: 参数注入 — 无条件强制覆盖

**问题**: ComfyUI API JSON 中 EmptyLatentImage 的 width/height 可能是数组引用格式 `["85", 0]`（typeof="object"），旧代码 `if (typeof !== 'object')` 会跳过。

**修复**: 遍历所有节点，无条件覆盖 width/height/batch_size：
```js
for (const [id, n] of Object.entries(u)) {
  if (nd.inputs.width !== undefined) nd.inputs.width = width.value
  if (nd.inputs.height !== undefined) nd.inputs.height = height.value
  if (nd.inputs.batch_size !== undefined) nd.inputs.batch_size = batchCount.value
}
```

提示词注入也改为通用匹配（支持 KSampler/KSamplerAdvanced/CLIPTextEncode/PrimitiveStringMultiline）。

### 决策 8: 执行模式 — 串行非并行

**原因**: ComfyUI 后端是串行处理的，并行提交任务会导致队列混乱和进度不准确。

**实现**: `triggerAllGenerators()` 用 `for...of` + `await` 串行执行：
```js
for (const [nodeId, fn] of genEntries) {
  runningNodeId.value = nodeId  // 绿色边框
  await fn()                     // 等当前节点完成
}
runningNodeId.value = null       // 清除边框
```

---

## 📁 文件清单

### 新建文件（7个）

| 文件 | 说明 |
|------|------|
| `src/stores/comfyui.ts` | Pinia Store：配置/工作流/连接测试 |
| `src/components/workspace/ComfyUIConfigPanel.vue` | ComfyUI 配置面板 |
| `src/components/workspace/WorkflowEditorPanel.vue` | 工作流编辑面板 |
| `src/components/nodes/ComfyUIConnectionNode.vue` | 连通节点（心跳检测） |
| `src/components/nodes/WorkflowLoaderNode.vue` | 工作流加载节点（watch同步） |
| `src/components/nodes/SingleImageGenerateNode.vue` | **核心**：单图生成（WS进度+blob图片） |
| `public/comfyui-config.json` | 配置文件模板（自动创建） |
| `public/workflow-api.json` | 工作流文件模板（自动创建） |

### 修改文件（6个）

| 文件 | 关键改动 |
|------|---------|
| `vite.config.ts` | JSON-API中间件 + proxy(ws:true) |
| `src/types/node.ts` | +ComfyUIConnection, +WorkflowAPI DataType |
| `src/config/dataTypes.ts` | 新数据类型颜色配置 |
| `src/config/nodes/index.ts` | 注册3个新节点类型 |
| `src/components/canvas/CanvasView.vue` | 注册节点+7个inject函数+串行执行+Backspace修复 |
| `src/components/nodes/DisplayImageNode.vue` | 支持blob:/data:/缓存ID三种格式 |
| `src/components/workspace/Workspace.vue` | 集成新面板 |

### CanvasView 注入函数一览

| inject key | 类型 | 用途 |
|------------|------|------|
| `isHandleConnected` | `(nodeId, handleId) => boolean` | 检查端口是否已连线 |
| `updateNodeDataById` | `(nodeId, data) => void` | 更新节点数据（创建新对象引用） |
| `disconnectHandle` | `(nodeId, handleId) => void` | 断开指定端口的连线 |
| `setNodesDraggable` | `(val) => void` | 设置节点是否可拖拽 |
| `getUpstreamNodeData` | `(nodeId, handleId) => data` | **实时**读取上游节点数据 |
| `propagateFromNode` | `(sourceId, dataOverride?) => void` | 向下游传播数据 |
| `setRunningNodeId` | `(id \| null) => void` | 设置绿色边框的节点 |
| `registerGenerator` | `(nodeId, fn) => void` | 注册可执行函数 |
| `unregisterGenerator` | `(nodeId) => void` | 注销可执行函数 |

---

## 🎯 已解决的关键问题

| # | 问题 | 解决方案 |
|---|------|---------|
| 1 | 一个输入点不能两条接连线 | Vue Flow 内置约束，无需额外处理 |
| 2 | Backspace 键误删节点 | 移除 Backspace 监听，只保留 Delete |
| 3 | 端口混乱/重复 | `:inputs="[]"` + 6个手动 Handle，参考 NumberInputNode |
| 4 | 连线后必须先点"执行"才能生成 | getUpstreamNodeData 直接读实时数据 |
| 5 | 图片显示在节点内部 | 改为 output 端口传给 DisplayImageNode |
| 6 | 并行执行导致进度错乱 | 改为 for...of 串行 + runningNodeId 绿色边框 |
| 7 | 图片无法预览(CORS) | fetch→blob→URL.createObjectURL 同源输出 |
| 8 | DisplayImageNode 后续不更新 | updateNodeDataById 创建新对象引用 + :key 强制重渲染 |
| 9 | 宽高参数不生效(数组引用) | 无条件强制覆盖 width/height/batch_size |
| 10 | 进度显示不准确(时间估算) | WebSocket 实时 progress 消息 (value/max) |

---

## 🔄 ComfyUI API 调用流程

### 完整生成流程

```
用户点击"开始生成" 或 "▶ 执行"
    │
    ├─ 1. getConnectionStatus()
    │      └─ getUpstreamNodeData(id, 'connection-input') → { status:'connected', url }
    │
    ├─ 2. getWorkflowData()
    │      └─ getUpstreamNodeData(id, 'workflow-input') → workflowContent (JSON对象)
    │
    ├─ 3. canGenerate 检查
    │      └─ connected && 有工作流 && prompt非空 && 未在生成
    │
    ├─ 4. setRunningNodeId(id)  → 绿色边框
    │
    ├─ 5. injectParameters(workflow)
    │      ├─ 遍历所有节点找 text 字段 → 替换为 prompt
    │      ├─ 遍历所有节点找 width/height/batch_size → 强制覆盖
    │      └─ SaveImage filename_prefix → gen_{timestamp}
    │
    ├─ 6. POST {url}/prompt  body: { prompt: updatedWorkflow }
    │      └─ 返回 { prompt_id: "uuid" }
    │
    ├─ 7. pollForResults(prompt_id, url)
    │      ├─ 建立 WebSocket: ws://{url}/ws?clientId={uuid}
    │      │   ├─ onmessage "progress"  → currentStepNum=value, totalStepNum=max
    │      │   ├─ onmessage "status"+"success" → 关闭WS, 标记完成
    │      │   └─ onerror/onclose → fallback 到轮询
    │      │
    │      ├─ setInterval /history/{pid} (每2s)
    │      │   └─ 有 outputs → extractImages(fetch→blob→URL)
    │      │
    │      └─ 超时保护 (10分钟)
    │
    ├─ 8. updateNodeDataById(id, { output: blobUrl })
    │
    ├─ 9. propagateFromNode(id, blobUrl)
    │      └─ DisplayImageNode.inputValue = blobUrl
    │
    └─ 10. setRunningNodeId(null) → 边框消失
```

### WebSocket 消息协议

```
客户端 → 服务端: 连接 ws://127.0.0.1:8188/ws?clientId=xxxxx

服务端 → 客户端 消息流:

{ type: "status", data: { status_str: "in_progress" } }
{ type: "execution_cached", node: "84" }
{ type: "executing", node: "109" }
{ type: "executed", node: "109" }
{ type: "executing", node: "138" }                          ← KSampler开始
{ type: "progress", data: { value: 1, max: 9, node: "138" } }  ← 步数1/9 ✅
{ type: "progress", data: { value: 2, max: 9, node: "138" } }  ← 步数2/9
...
{ type: "progress", data: { value: 9, max: 9, node: "138" } }  ← 步数9/9
{ type: "executed", node: "138" }
{ type: "execution_cached", node: "84" }
{ type: "executing", node: "60" }
{ type: "executed", node: "60" }
{ type: "status", data: { status_str: "success" } }            ← 完成 ✅
```

---

## 🧪 验证通过的测试场景

- [x] ComfyUI 配置面板保存/加载正常
- [x] 连接节点自动检测连通性（心跳30s）
- [x] 工作流导入/选择/保存正常
- [x] 连线后单图节点直接变紫色（准备就绪）
- [x] 点"开始生成"能独立运行单个节点
- [x] 点"▶ 执行"串行运行所有节点 + 绿色边框跟随
- [x] WebSocket 精确步数进度（如 5/9）
- [x] 生成图片通过 DisplayImageNode 正确显示
- [x] 多次生成图片都能正确刷新显示
- [x] 宽度/高度参数能正确控制输出尺寸
- [x] Backspace 键不再误删节点
- [x] LoadImageNode → DisplayImageNode 图片传递正常

---

## 🚀 后续扩展方向

- [ ] 批量生成节点（循环扩展单图节点）
- [ ] 工作流可视化预览（JSON → 节点图渲染）
- [ ] 多 ComfyUI 实例支持
- [ ] 生成历史记录与版本管理
- [ ] 高级参数调节（采样器/CFG/种子等控件暴露）
- [ ] 节点执行性能监控仪表盘
- [ ] LoRA/模型动态切换
- [ ] 图生图（img2img）工作流支持

---

*文档版本: v1.1 (实施完成版)*
*基于实际开发过程中的所有技术决策和问题修复*
