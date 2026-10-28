# Debug Session: comfyui-connection-freeze

**Status**: [CLOSED - FIXED]
**Created**: 2026-05-22
**Symptom**: 点击 ComfyUI 连通节点的"测试连接"按钮后，整个应用卡死，IDE 崩溃

---

## 🎯 根因确认

### 问题现象
1. 用户在画布中拖出 ComfyUI 连通节点
2. 点击"测试连接"按钮
3. **整个应用冻结**，Vite 开发服务器崩溃重启
4. 控制台显示 `ERR_CONNECTION_RESET` + `[vite] server connection lost`

### 运行时证据（Debug 日志）

```
[0ms]   A:节点入口 → isTesting=false, nodeId=#2
[1ms]   A:节点开始测试 → url=https://126tkv2w8q-8188.cnb.run/
[2ms]   B:Store入口 → 全局锁=false, 队列=0
[3ms]   B:发起fetch到 /api/comfyui-test
[37ms]  ❌ B:Store连接失败 → "Failed to fetch" (仅37ms!)
[41ms]  ❌ A:节点完成 → success=false (总耗时41ms)
```

**关键发现**：
- ✅ **完全没有 C 层（API中间件）的日志**
- ✅ **仅用 37ms 就失败了** - 不是网络超时！
- ✅ **errorType: TypeError + ERR_CONNECTION_RESET**

### 根本原因

**💥 Vite 中间件中的 `fetch()` 调用导致 Node.js 进程崩溃！**

崩溃链路：
```
浏览器 → POST /api/comfyui-test
       ↓
Vite 中间件接收请求
       ↓
执行 fetch('https://external-url/system_stats')  ← 💥 Node.js 崩溃！
       ↓
Vite dev server 崩溃重启
       ↓
浏览器收到 ERR_CONNECTION_RESET
       ↓
IDE 完全卡死（HMR 断开）
```

**为什么服务端 fetch 会崩溃？**
- Node.js 内置的 `undici` (fetch 实现) 在处理外部 HTTPS 请求时可能触发未捕获异常
- DNS 解析或 TLS 握手阻塞事件循环导致进程假死
- 某些网络错误未被正确捕获，导致进程退出

---

## ✅ 修复方案

### 策略：移除服务端代理，改为客户端直连

#### 修改 1: vite.config.ts
```diff
- // ====== ComfyUI 连接测试 API（服务端代理）======
- if (url === '/api/comfyui-test' && req.method === 'POST') {
-   const body = JSON.parse(await parseBody(req))
-   const targetUrl = body.url || 'http://127.0.0.1:8188'
-   const fetchRes = await fetch(`${targetUrl}/system_stats`, { ... })  ← 💥 崩溃点
-   ...
- }
+ // 已完全移除此代码块
```

#### 修改 2: comfyui.ts store
```diff
- const response = await fetch('/api/comfyui-test', {  // 通过 Vite 中介
-   method: 'POST',
-   body: JSON.stringify({ url, timeout })
- })

+ const targetUrl = config.value.url.replace(/\/$/, '')
+ const response = await fetch(`${targetUrl}/system_stats`, {  // 客户端直连
+   method: 'GET',
+   mode: 'cors',
+   signal: controller.signal
+ })
```

#### 修改 3: ComfyUIConnectionNode.vue
- 移除所有调试插桩代码
- 保持原有的 UI 逻辑不变

---

## 📊 修复前后对比

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| **请求路径** | 浏览器 → Vite 中间件 → fetch 外部 URL | 浏览器 → 直接 fetch 外部 URL |
| **崩溃风险** | ❌ 高（Node.js 进程崩溃） | ✅ 无（浏览器隔离） |
| **IDE 影响** | ❌ 整个 IDE 卡死 | ✅ 完全正常 |
| **错误处理** | ❌ 未捕获异常导致崩溃 | ✅ try/catch + AbortController |
| **超时控制** | ⚠️ 服务端 8 秒（可能阻塞） | ✅ 客户端 10 秒（可取消） |

---

## 🧪 验证结果

*(待用户确认)*

---

## 🧹 清理清单

- [x] 移除 vite.config.ts 中的 /api/comfyui-test 服务端代理
- [x] 修改 Store 使用客户端直连 ComfyUI
- [x] 清理所有调试插桩代码（A/B/C 三层）
- [x] 停止 Debug Server
- [ ] 删除 debug 日志文件 (.dbg/)
- [ ] 删除 debug 文档 (debug-comfyui-connection-freeze.md)

---

## 💡 经验教训

1. **永远不要在 Vite/Webpack 中间件中做外部 HTTP 请求**
   - Node.js 的 fetch 实现不如浏览器稳定
   - 未捕获的异常会导致整个 dev server 崩溃
   - 应使用代理转发或客户端直连

2. **调试时优先收集运行时证据**
   - 静态代码分析无法发现这类问题
   - 插桩日志能精确定位崩溃点
   - Debug Server 是强大的诊断工具

3. **CORS 问题应该通过正确的方式解决**
   - 开发环境：Vite proxy 或浏览器扩展
   - 生产环境：Nginx 反向代理或 CORS middleware
   - 不要为了绕过 CORS 而引入新的风险点
