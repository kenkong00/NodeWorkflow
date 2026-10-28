# ComfyUI 逆向分析报告

> 分析对象：`I:\TREA work\rea\ComfyUI-aki-v3`（绘世启动器整合包，ComfyUI **v0.9.2**）
> 分析方法：**纯源码级逆向**，非猜测。三条证据链：
> 1. **Sourcemap 还原**：从 `python/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map` 的 `sourcesContent` 中提取出 **940 个 ComfyUI 前端原始源文件**（TS/Vue），落在 `I:\TREA work\rea\_逆向分析\frontend-src\`（含完整 LiteGraph 引擎 TS 源码 `src/lib/litegraph/`）。
> 2. **调色板提取**：从前端 bundle `index-ClJ8cazm.js` 中提取出 ComfyUI 内置的 5 套完整调色板（节点色/端口色/连线色/UI 色）。
> 3. **真机节点表导出**：用整合包自带 `python/python.exe` 导入 `comfy.nodes` + `init_builtin_extra_nodes()`，按 `server.py: node_info()` 同款逻辑导出 **434 个基础节点**的完整 V1 schema，落在 `_逆向分析\comfyui_object_info.json`。
> 4. **rea 逆向 CLI**：`I:\TREA work\rea\rea`（rea-agents v6.4.0）已构建成功（`npm ci && npm run build:cached`，27s），可对二进制（如 `绘世启动器.exe`）做进程/JS 应用分析；本次因 ComfyUI 前后端均为开源代码，源码级逆向更权威，rea 作为备用通道保留。
> 5. 后端直接读 `ComfyUI/` 下 Python 源码：`nodes.py`(2466 行) / `execution.py`(1251 行) / `server.py`(1228 行) / `comfy_execution/graph.py` / `custom_nodes/ComfyUI-Manager`。

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 comfyui_frontend_package（Vue3 + TS + Vite）              │
│  ├─ LiteGraph 引擎（TS fork：LGraph/LGraphNode/LGraphCanvas/   │
│  │   LLink/LinkConnector/DragAndScale…）                     │
│  ├─ Vue 节点渲染层 renderer/extensions/vueNodes/               │
│  │   （NodeHeader/NodeSlots/NodeWidgets/SlotConnectionDot）   │
│  ├─ services/litegraphService.ts + comfyRegistryService.ts    │
│  └─ 与后端：GET /object_info（节点表）POST /prompt WS /ws      │
├─────────────────────────────────────────────────────────────┤
│ 后端 Python（aiohttp，server.py）                             │
│  ├─ nodes.py：NODE_CLASS_MAPPINGS 注册表 + custom_nodes 加载   │
│  ├─ execution.py：validate_prompt / validate_inputs / 执行     │
│  ├─ comfy_execution/graph.py：ExecutionList 拓扑调度+环检测     │
│  ├─ folder_paths.py：模型/输入/输出目录管理                     │
│  └─ custom_nodes/：插件（ComfyUI-Manager 等 9 个已装）          │
└─────────────────────────────────────────────────────────────┘
```

前后端通过 **`/object_info` 节点表 + `/prompt` API 格式** 解耦：前端只认 schema，后端只认 prompt。**这套解耦就是「系统与插件关系」的核心**，下面详述。

---

## 二、节点是怎么设计的（V1 schema，本报告重点）

### 2.1 节点 = 一个 Python 类，导出固定契约

```python
class CLIPTextEncode:
    @classmethod
    def INPUT_TYPES(cls):        # 输入契约（required + optional 两组）
        return {"required": {"text": ("STRING", {"multiline": True}), "clip": ("CLIP",)}}
    RETURN_TYPES = ("CONDITIONING",)   # 输出类型元组
    FUNCTION = "encode"                 # 执行方法名
    CATEGORY = "conditioning"           # 菜单分类（支持 "a/b" 子分类）
    OUTPUT_NODE = False                 # True = 输出节点（执行入口）
    DESCRIPTION = "..."                 # 悬停说明
```

`/object_info` 每个节点导出的字段（`server.py:652` `node_info()`）：

| 字段 | 含义 | 渲染/执行用途 |
|---|---|---|
| `input.required/optional` | `{名: [类型, 配置dict]}` | 端口 + 控件；required 缺失即校验失败 |
| `output` / `output_name` | 类型元组 / 名称元组 | 输出端口 |
| `output_is_list` | 是否输出列表 | 执行解包 |
| `function` | 执行方法名 | 后端调用 |
| `category` | 分类（`/` 分级） | 节点菜单树 |
| `output_node` | 是否执行入口 | validate_prompt 找输出的起点 |
| `description`/`output_tooltips` | 说明 | tooltip |
| `python_module` | 来源模块 | 排查插件来源 |

### 2.2 输入类型 = 控件类型映射（前端 `widgetRegistry.ts` 实证）

| schema 类型/配置 | 前端控件 | 说明 |
|---|---|---|
| `INT` + `min/max/step` | number | 数值控件 |
| `FLOAT` | number(slider) | |
| `BOOLEAN` | toggle | |
| `STRING` + `multiline:true` | textarea | 多行文本 |
| `STRING` | text | |
| `[选项1,选项2,…]`（数组而非字符串） | combo/select | 下拉 |
| `COLOR` | color picker | |
| `INT` + `control_after_generate` | **seed 控件** | 带 randomize/fixed/increment 小按钮 |
| 控件所在输入若被连线 | 控件变暗 | **连线值覆盖控件值**（这正是旧项目反复出 bug 的规则，见 §2.4） |

类型即颜色：`IMAGE/LATENT/MODEL/CLIP/VAE/CONDITIONING/MASK/CONTROL_NET/STYLE_MODEL/NOISE/GUIDER/SAMPLER/SIGMAS/TAESD` 各有固定色（§五）。

### 2.3 执行契约（prompt API 格式）

```json
{ "3": { "class_type": "KSampler",
         "inputs": { "model": ["1", 0], "seed": 123, "steps": 20 } } }
```
- 控件值 = 字面量；连线值 = `[上游节点id, 上游output序号]` 二元组。
- 这就是前端 `graphToPrompt` 的产物，也是新系统执行引擎的输入格式（完全兼容）。

### 2.4 执行校验规则（`execution.py` 实证）

1. `validate_prompt`：找出所有 `OUTPUT_NODE=True` 的节点 → 没有则报 `prompt_no_outputs`；逐个递归 `validate_inputs`。
2. `validate_inputs`（递归上游）：
   - **required 缺失** → `required_input_missing`；
   - **连线类型不符** → `return_type_mismatch`（`validate_node_input(received, expect)`：通配 `*` 万能、`INT/FLOAT/STRING/BOOLEAN` 间有兼容表）；
   - 字面量按类型强转（INT/FLOAT/STRING/BOOLEAN 转换失败即报错）；
   - 超出 `min/max` → `value_smaller_than_min` 等；
   - 错误按节点归类 `node_errors[node_id] = {errors, dependent_outputs, class_type}`。
3. 上游出错 → 下游标 invalid 但不附错误（只报根因）。

---

## 三、连接规则（前端 `LinkConnector.ts` / `LGraphNode.ts` / `LiteGraphGlobal.ts` 实证）

### 3.1 端口与连线结构

- 节点**左输入右输出**；输入端口 `link: linkId|null`（**单连线**），输出端口 `links: linkId[]`（**多连线**）。
- 连线 `LLink = {id, type, origin_id, origin_slot, target_id, target_slot}`，全局 `graph._links` 管理，id 自增。
- 输入端口已连线时接入新线 → **自动断开旧线**（`connectSlots` L2840）。
- EVENT 类型输出默认单线（`allow_multi_output_for_events` 可改）。

### 3.2 类型匹配 `LiteGraph.isValidConnection(type_a, type_b)`（L684，逐行实证）

```
1. type 为 "" 或 "*" → 视为 0（通配，连万物）
2. 任一侧为通配 → true
3. 完全相等（toLowerCase 后）→ true
4. EVENT ↔ ACTION 特殊互通 → true
5. 任一侧含逗号（多类型）→ 两侧做全排列，任一相等 → true
6. 其余 → false
```

### 3.3 交互规则（`LGraphCanvas.ts` L2704-2777 实证）

| 操作 | 行为 |
|---|---|
| 从**输出端口**按下拖动 | 拖出新连线（虚线跟随），松开落到合法输入 → 实线连接 |
| 从**已连线的输入端口**拖动 | **搬移整条旧线**（`moveInputLink`），不是新线 |
| **Shift+** 从已连线的**输出端口**拖动 | 搬移该输出的**全部**出线 |
| **Ctrl+Alt+点击** 已连线端口 | 直接断开（`ctrl_alt_click_do_break_link=true` 默认开） |
| 拖到不匹配端口 | 鼠标显示禁止/端口不高亮；类型匹配才吸附 |
| 同一节点自有输入↔输出 | 禁止（`connect()` L2717 `target_node == this → null`） |
| 拖到空白松开 | 默认无菜单（`release_link_on_empty_shows_menu=false`） |

### 3.4 环：前端不阻止，后端执行时检测

`comfy_execution/graph.py` L247：拓扑调度时若无就绪节点但图非空 → `DependencyCycleError`，并定位环上节点 blame。**这是旧项目没有的关键能力。**

### 3.5 其它引擎能力（照搬范围）

- 节点拖动/框选/多选/复制粘贴（Ctrl+C/V）、Delete 删除、Alt 拖动克隆。
- 节点缩放（右下角句柄，`computeSize` 自适应，控件跟随）。
- 折叠节点、Bypass（紫色）、Group 分组。
- Reroute 中转点（拖线时双击空白生成）。
- 右键菜单 / 双击画布打开搜索框加节点 / 网格吸附。

---

## 四、系统与插件的关系（`nodes.py` L2137-2279 + Manager 实证）

### 4.1 加载机制（启动时 `init_external_custom_nodes`）

```
custom_nodes/ 目录
 ├─ xxx.py            → importlib 动态导入为模块
 └─ xxx/__init__.py   → 包导入
      ↓ 模块需导出（二选一）
 ├─【V1】NODE_CLASS_MAPPINGS = {"Name": Class}   ← 主流
 │        NODE_DISPLAY_NAME_MAPPINGS = {...}
 └─【V3】comfy_entrypoint() → ComfyExtension → get_node_list()
      ↓ 注册
 ├─ 节点名冲突处理：基础节点名在 ignore 集合，**插件不能覆盖内置节点**
 ├─ WEB_DIRECTORY = "js" → 注册 EXTENSION_WEB_DIRS → 静态服务 /extensions/<模块名>/
 │  （pyproject.toml [tool.comfy] web = "js" 也可自动注册）
 └─ RELATIVE_PYTHON_MODULE 记录来源
```

- `.disabled` 后缀目录/文件跳过；`--disable-all-custom-nodes` + 白名单可全禁。
- 每个模块导入计时打日志（本次实测 9 个插件全部加载成功）。

### 4.2 ComfyUI-Manager（GitHub 插件自由安装的实证）

- `repo_install(url)`：`git clone --recursive` 到 `custom_nodes/<repo>`；
- `execute_install_script`：跑插件自带 `install.py`，无则 `pip install -r requirements.txt`；
- enable/disable（`.disabled` 重命名）、update（git pull）、snapshot（按工作流缺失节点一键补齐安装）；
- 内置 `custom-node-list.json` 节点市场索引 + 每日 GitHub stars 统计。

### 4.3 前端扩展

`/extensions` 路由列出所有已注册插件的 JS 目录；插件前端 JS 通过全局 `comfyAPI`（`app.registerExtension(...)`）挂菜单/侧栏/设置/覆盖渲染。**即：插件 = 后端节点 + 前端扩展，两侧都用同一种注册表模式。**

### 4.4 模型文件管理

`folder_paths.py`：`models/checkpoints|loras|vae|controlnet|clip_vision|...` 分类目录 + `extra_model_paths.yaml` 多路径配置；`/models`、`/view` API 供前端拉列表/图。**节点不持有模型路径，路径由系统统一管理**——这是「运行环境集成在系统里」的体现。

---

## 五、视觉规范（从 bundle 提取的 ComfyUI「Dark (Default)」官方调色板）

节点端口/连线颜色（`node_slot`）：

| 类型 | 色值 | 类型 | 色值 |
|---|---|---|---|
| CLIP | `#FFD500` | VAE | `#FF6E6E` |
| CONDITIONING | `#FFA931` | MODEL | `#B39DDB` |
| IMAGE | `#64B5F6` | LATENT | `#FF9CF9` |
| MASK | `#81C784` | CONTROL_NET | `#6EE7B7` |
| CLIP_VISION | `#A8DADC` | STYLE_MODEL | `#C2FFAE` |
| NOISE | `#B0B0B0` | GUIDER | `#66FFFF` |
| SAMPLER | `#ECB4B4` | SIGMAS | `#CDFFCD` |

引擎基色（`litegraph_base`）：节点体 `#353535`、标题栏 `#333`、边框 `#666`、标题文字 `#999`、控件底 `#222`、控件文字 `#DDD`、默认连线 `#9A9`、错误 `#E00`、Bypass `#FF00FF`、形状 **ROUND（圆角）**、字号 14/12。
UI 基色（`comfy_base`）：菜单底 `#171718`、输入框 `#222`、边框 `#4e4e4e`、错误文字 `#ff4444`。

---

## 六、对新系统的改造结论（本报告的落地项）

1. **连接引擎**：直接采用与 ComfyUI 同源的 LiteGraph.js（npm `litegraph.js`，ComfyUI 前端即其 fork），交互与 §3 完全一致；类型匹配函数按 §3.2 原样实现。
2. **节点系统**：registry 驱动，schema 完全兼容 `/object_info` V1 格式；**434 个基础节点定义已全量导出**（`_逆向分析/comfyui_object_info.json`），照搬进新系统注册表；可在 TS 中实现逻辑的节点原生执行，其余经「ComfyUI 执行器」插件转发真实 ComfyUI 运行。
3. **执行引擎**：按 §2.4 校验（required/类型/值域）+ §3.4 环检测 + 拓扑分批（输出节点优先）+ WebSocket 进度事件，prompt 格式与 ComfyUI 完全一致。
4. **插件系统**：`plugins/<名>/` 目录动态加载，导出 `NODE_CLASS_MAPPINGS` + 可选 `WEB_DIRECTORY`；Manager 式 `git clone` 安装 / 启用停用（`.disabled`）/ 更新；基础节点不可被覆盖。
5. **持久化**：工作流按 ComfyUI 格式（nodes/links/widgets_values/last_node_id/last_link_id）存 SQLite，节点大小、控件值、位置全部保留（修掉旧项目「刷新丢状态」类 bug）。
6. **视觉**：按 §五 官方调色板 1:1 复刻（深色节点、圆角、彩色端口/连线、Inter 字体）。
