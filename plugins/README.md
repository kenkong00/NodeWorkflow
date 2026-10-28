# 插件系统（与 ComfyUI custom_nodes 同构）

## 目录结构

```
plugins/
├── comfy-executor/        # 内置：ComfyUI 委托执行器（MODEL/LATENT 类节点转发真实 ComfyUI）
│   └── plugin.js
├── example/               # 示例插件
│   ├── index.js           # 入口（也可用 plugin.js）
│   └── js/                # WEB_DIRECTORY 前端扩展（挂载 /extensions/example/）
└── <你的插件>/
```

## 安装方式

1. **从 GitHub 安装**：顶栏「🧩 插件」→ 输入仓库地址 → 安装（内部执行 `git clone --recursive`）。
2. **手动安装**：把插件目录复制到 `plugins/` 下，重启或点「重新加载」。
3. **停用/卸载**：插件管理中点「停用」（目录加 `.disabled` 后缀，与 ComfyUI 一致）或「卸载」。

## 插件入口约定（plugin.js / index.js）

```js
// 1) 节点（对应 ComfyUI V1 NODE_CLASS_MAPPINGS）
export const NODE_CLASS_MAPPINGS = {
  MyNode: {
    def: {                       // /object_info V1 schema，与 ComfyUI 完全一致
      input: { required: { text: ['STRING', { multiline: true }] } },
      output: ['STRING'],
      output_name: ['OUT'],
      name: 'MyNode',
      display_name: '我的节点',
      description: '...',
      python_module: 'plugin.my',
      category: 'utils/text',
      output_node: false          // true = 输出节点（执行入口）
    },
    impl: {                      // TS/JS 原生实现（可选）
      execute: async (ctx) => ({ result: ['...'] })
    }
  }
}

// 2) 显示名（可选）
export const NODE_DISPLAY_NAME_MAPPINGS = { MyNode: '我的节点' }

// 3) 前端扩展目录（可选，静态挂载 /extensions/<插件名>/）
export const WEB_DIRECTORY = 'js'

// 4) 委托执行器（可选，如 comfy-executor）
export const EXECUTORS = [{
  id: 'my-executor',
  name: '我的执行器',
  canExecute: (prompt, registry) => true,
  execute: async (prompt, events, opts) => new Map()
}]

// 5) 宿主上下文（可选）
export function init(host) {
  // host.getComfyConfig() → { url } | null  读取当前启用的 ComfyUI 连接
  // host.projectRoot                       项目根目录
}
```

## 规则（复刻 ComfyUI）

- 插件**不能覆盖内置节点**（434 个基础节点名受保护）。
- `output_node: true` 的节点是执行入口（工作流必须至少有一个）。
- 无原生实现的节点由执行器插件接管（默认 comfy-executor 转发到真实 ComfyUI）。
- 执行上下文 `ctx.inputs`：连线输入已解析为上游输出值；控件输入为字面量。
- 节点可返回 `ui`（展示数据）：`{ images: [...] }` / `{ text: [...] }` / `{ chat: [...] }`。
