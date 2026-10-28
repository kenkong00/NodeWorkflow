# ComfyUI 精确步数进度追踪方案

## 问题分析

当前进度显示问题：
- **时间估算不可靠**：本地出图40s、云端5s，差距8倍，固定每步2.5s的估算完全不准
- **/queue API extras 字段不稳定**：不同 ComfyUI 版本格式不同，经常为空
- 用户期望：像 ComfyUI 原生界面一样显示 **"当前步数/总步数"**（如 `4/9`）

## 解决方案：WebSocket 实时进度

### ComfyUI WebSocket API（最精确）

ComfyUI 提供了 WebSocket 接口，实时推送每个节点的执行进度：

```
连接地址: ws://{comfyui_host}:8188/ws?clientId={uuid}
```

**收到的消息类型与格式：**

| type | 说明 | 数据结构 |
|------|------|----------|
| `status` | 执行状态 | `{ status_str: "success" \| "error", ... }` |
| `progress` | **采样进度** ✅ | `{ data: { value: 4, max: 9, node: "138" } }` |
| `execution_cached` | 节点缓存命中 | `{ node: "138", ... }` |
| `executing` | 当前执行节点 | `{ node: "138", ... }` |
| `executed` | 节点执行完成 | `{ node: "138", ... }` |

**关键：`progress` 消息的 `data.value` = 当前步数，`data.max` = 总步数**

### 从工作流 JSON 获取总步数（已实现）

用户的工作流使用的是 **KSamplerAdvanced**（节点138），`steps: 9`：
```json
"138": {
  "inputs": {
    "steps": 9,
    ...
  },
  "class_type": "KSamplerAdvanced"
}
```

`extractTotalSteps()` 已支持 KSamplerAdvanced，这个保留作为初始值。

## 实施步骤

### 步骤 1：修改 SingleImageGenerateNode.vue — pollForResults 改为 WebSocket + /history 双轨

**核心逻辑变更：**

```
startGeneration()
  ├── POST /prompt → 获得 prompt_id
  ├── 建立 WebSocket 连接 (ws://comfyui_url/ws?clientId=xxx)
  │   ├── onmessage → type="progress" → 更新 currentStepNum/totalStepNum
  │   ├── onmessage → type="executing"/"executed" → 追踪节点完成状态
  │   └── onmessage → type="status" + status_str="success" → 关闭WS，取结果
  └── 同时保留 /history/{pid} 轮询作为 fallback（WS断开时）
      └── 检测到 outputs → 提取图片 → 完成
```

**具体代码改动：**

1. 新增 `connectWebSocket(base, promptId)` 函数
   - 创建 `new WebSocket(wsUrl)` 
   - 注意 URL 格式转换：`http://127.0.0.1:8188` → `ws://127.0.0.1:8188/ws?clientId=xxx`
   - onmessage 解析 JSON，根据 `type` 分发处理
   - `progress` 类型：`msg.data.value` → currentStepNum，`msg.data.max` → totalStepNum
   - `status` 类型且 `status_str === "success"`：标记完成，关闭 WS
   - 错误处理：WS 断开时自动 fallback 到轮询模式

2. 重写 `pollForResults(promptId, base)`
   - 先启动 WebSocket 连接
   - 同时启动 /history 轮询（降低频率到 2s 一次）
   - 任一方式检测到完成就返回图片
   - 超时保护不变（10分钟）

3. 清理资源
   - 生成完成后关闭 WebSocket 连接
   - 组件卸载时也关闭（防内存泄漏）

### 步骤 2：Vite 代理配置 — 添加 WebSocket 代理

在 vite.config.ts 的 proxy 中添加 WebSocket 支持：

```js
proxy: {
  '/comfyui-proxy': {
    target: 'http://127.0.0.1:8188',
    rewrite: (p) => p.replace(/^\/comfyui-proxy/, ''),
    ws: true  // 启用 WebSocket 代理
  }
}
```

这样前端可以用 `ws://localhost:5173/comfuyi-proxy/ws?clientId=xxx` 连接（通过代理转发）。
但实际上 **WebSocket 直接连 ComfyUI 即可**，因为 WebSocket 协议不受 CORS 限制。所以代理只是可选优化。

### 步骤 3：按钮文字显示优化

保持现有的 `generateButtonText` computed 逻辑不变：

```js
if (totalStepNum.value > 0 && currentStepNum.value >= 0) {
  return `生成中... ${currentStepNum.value}/${totalStepNum.value}`
}
```

WebSocket 推送的真实数据会让这个显示精确到每一步。

## 文件修改清单

| 文件 | 改动内容 |
|------|----------|
| `src/components/nodes/SingleImageGenerateNode.vue` | 新增 WebSocket 进度追踪，重写 pollForResults |
| `vite.config.ts` | （可选）添加 `ws: true` 到代理配置 |

## 预期效果

- 本地出图（~40s，9步）：`生成中... 1/9` → `2/9` → ... → `9/9` → 图片出现
- 云端出图（~5s，9步）：`生成中... 1/9` → 快速跳到 → `9/9` → 图片出现
- 两种环境都显示**真实步数**，不再有时间估算误差
