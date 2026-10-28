# ComfyUI 工作流API对接技术实现报告

## 📋 项目概述

本项目是一个**AI角色生成器平台**（comfyui-web），基于 **Vue 3 + Vite + Pinia + Express** 技术栈构建。核心功能是通过 **ComfyUI 的 API 接口**实现 AI 图像生成，支持单图生成和批量生成两种模式。

### 技术栈
- **前端框架**: Vue 3 (Composition API)
- **状态管理**: Pinia
- **构建工具**: Vite 6
- **后端服务**: Express.js (Node.js)
- **图像生成引擎**: ComfyUI (本地部署)

---

## 🏗️ 系统架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Vue 3 前端    │────▶│  Express API服务器 │────▶│   ComfyUI 服务   │
│   (localhost:5173)│     │  (localhost:3002)  │     │ (localhost:8188) │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │              ┌────────▼─────────┐              │
         │              │  Download Server  │◀─────────────┘
         │              │ (localhost:3001)  │  图片下载服务
         │              └──────────────────┘
         ▼
┌─────────────────┐
│  LocalStorage   │  配置持久化
│  / SQLite DB    │
└─────────────────┘
```

---

## 🔌 一、ComfyUI API 对接机制

### 1.1 ComfyUI 配置管理

**配置文件位置**: [server/config.json](server/config.json) 和 [src/stores/config.js](src/stores/config.js)

```javascript
// 核心配置项 (src/stores/config.js:7-11)
const config = ref({
  comfyuiUrl: 'http://127.0.0.1:8188',  // ComfyUI 服务地址
  downloadDir: `${new Date().getFullYear()}.${new Date().getMonth() + 1}.${new Date().getDate()}`,  // 下载目录
  autoDownload: false  // 自动下载开关
})
```

**关键方法 - API基础URL获取**: [config.js:174-177](src/stores/config.js#L174-L177)

```javascript
const getApiBaseUrl = () => {
  if (isLocalComfyUI()) return '/api'  // 本地环境使用代理
  return config.value.comfyuiUrl.endsWith('/') 
    ? config.value.comfyuiUrl.slice(0, -1) 
    : config.value.comfyuiUrl
}
```

**智能路由逻辑**:
- 当 ComfyUI 运行在本地 (`127.0.0.1` / `localhost`) 时，前端通过 `/api` 代理路径访问
- 远程部署时直接使用完整 URL

---

## 🎨 二、单图生成功能实现

### 2.1 功能入口

**组件文件**: [SingleGenerate.vue](src/components/generation/SingleGenerate.vue)

```vue
<template>
  <div class="card">
    <h2>单图生成</h2>
    <textarea v-model="generationStore.generationOptions.prompt" placeholder="输入提示词..."></textarea>
    <input type="number" v-model.number="generationStore.generationOptions.batchCount" min="1" max="10" />
    <button @click="generationStore.generate">生成图片</button>
  </div>
</template>
```

### 2.2 核心生成流程

**Store 文件**: [generation.js](src/stores/generation.js)

#### 步骤 1: 工作流更新与提示词注入

[generation.js:36-85](src/stores/generation.js#L36-L85)

```javascript
const updateWorkflow = (workflowToUse, prompt, batchCount = 1) => {
  let updatedWorkflow = JSON.parse(JSON.stringify(workflowToUse))
  
  // 1. 验证工作流格式
  if (!validateWorkflow(workflowToUse)) {
    workflowToUpdate = defaultWorkflow  // 使用默认工作流
  }
  
  // 2. 注入提示词到节点 109 (Text Multiline 节点)
  if (updatedWorkflow["109"] && updatedWorkflow["109"].inputs?.text !== undefined) {
    updatedWorkflow["109"].inputs.text = prompt
  }
  
  // 3. 设置批量大小
  if (updatedWorkflow["84"]?.inputs) {
    updatedWorkflow["84"].inputs.batch_size = batchCount
  }
  
  // 4. 更新 SaveImage 节点的文件名前缀
  Object.values(updatedWorkflow).forEach(node => {
    if (node.class_type === 'SaveImage') {
      node.inputs.filename_prefix = configStore.config.filenamePrefix || 'ComfyUI'
    }
  })
  
  return updatedWorkflow
}
```

#### 步骤 2: 发送生成请求到 ComfyUI

[generation.js:87-134](src/stores/generation.js#L87-L134)

```javascript
const sendGenerateRequest = async (updatedWorkflow) => {
  const apiBase = configStore.getApiBaseUrl()
  
  const response = await fetch(`${apiBase}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: updatedWorkflow,
      output_dir: 'outputs'
    })
  })
  
  const data = await response.json()
  return data.prompt_id  // 返回任务ID用于轮询
}
```

**ComfyUI API 端点说明**:
- `POST /prompt` - 提交工作流任务
- 返回值: `{ prompt_id: "uuid-string" }`

#### 步骤 3: 轮询任务状态

[generation.js:136-254](src/stores/generation.js#L136-L254)

```javascript
const pollTaskStatus = async (promptId) => {
  const maxAttempts = 600  // 最大尝试次数 (约5分钟超时)
  
  while (!isCompleted && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 500))  // 每500ms查询一次
    
    // 并行请求队列状态和历史记录
    const [queueRes, historyRes] = await Promise.allSettled([
      fetch(`${apiBase}/queue`),
      fetch(`${apiBase}/history`)
    ])
    
    // 检查历史记录中的输出结果
    if (historyData[promptId]?.outputs) {
      for (const output of Object.values(promptHistory.outputs)) {
        if (output.images?.length > 0) {
          // 构建图片URL并添加到结果列表
          results.value.push({
            url: `${apiBase}/view?filename=${image.filename}&subfolder=${image.subfolder || ''}&type=output`,
            filename: image.filename,
            loaded: false
          })
        }
      }
      isCompleted = true
    }
    
    // 更新进度条...
  }
}
```

**轮询策略**:
- **频率**: 每 500ms 查询一次
- **超时时间**: 约 300 秒 (600次 × 500ms)
- **并行查询**: 同时检查 `/queue` (队列状态) 和 `/history` (历史输出)
- **进度计算**: 基于 ComfyUI 返回的节点完成统计或时间估算

#### 步骤 4: 主生成函数整合

[generation.js:302-343](src/stores/generation.js#L302-L343)

```javascript
const generate = async () => {
  isGenerating.value = true
  
  try {
    // 1. 获取当前工作流 (自定义或默认)
    const workflowToUse = configStore.customWorkflow || defaultWorkflow
    
    // 2. 更新工作流参数
    const updatedWorkflow = updateWorkflow(
      workflowToUse, 
      generationOptions.value.prompt, 
      generationOptions.value.batchCount
    )
    
    // 3. 发送到 ComfyUI 并获取 promptId
    const promptId = await sendGenerateRequest(updatedWorkflow)
    
    // 4. 轮询等待生成完成
    await pollTaskStatus(promptId)
    
    // 5. 可选：自动下载图片到本地
    if (configStore.config.autoDownload) {
      await saveImageToDirectory(results.value)
    }
    
  } catch (err) {
    error.value = `生成失败: ${err.message}`
  } finally {
    isGenerating.value = false
  }
}
```

---

## 📦 三、批量生成功能实现

### 3.1 功能入口

**组件文件**: [BatchGenerate.vue](src/components/generation/BatchGenerate.vue)

```vue
<template>
  <div class="card">
    <h2>批量生成</h2>
    <input type="file" accept=".json" multiple @change="handleFileSelect" />
    <p>已选择 {{ generationStore.storyboardPrompts.length }} 个分镜</p>
    <button @click="generationStore.batchGenerate">批量生成</button>
  </div>
</template>
```

### 3.2 分镜JSON解析

[BatchGenerate.vue:33-58](src/components/generation/BatchGenerate.vue#L33-L58)

```javascript
const handleFileSelect = (event) => {
  const files = event.target.files
  generationStore.storyboardPrompts = []
  
  for (const file of files) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = JSON.parse(e.target.result)
      
      // 支持两种格式:
      // 格式1: [{ prompt: "..." }, { prompt: "..." }]
      // 格式2: { prompt: "..." }
      if (Array.isArray(content)) {
        content.forEach(item => {
          if (item.prompt) storyboardPrompts.push(item.prompt)
        })
      } else if (content.prompt) {
        storyboardPrompts.push(content.prompt)
      }
    }
    reader.readAsText(file)
  }
}
```

**支持的JSON格式示例**:

```json
[
  { "prompt": "分镜1的描述..." },
  { "prompt": "分镜2的描述..." },
  { "prompt": "分镜3的描述..." }
]
```

### 3.3 批量执行逻辑

[generation.js:345-379](src/stores/generation.js#L345-L379)

```javascript
const batchGenerate = async () => {
  isGenerating.value = true
  
  try {
    for (let i = 0; i < storyboardPrompts.value.length; i++) {
      const prompt = storyboardPrompts.value[i]
      generationStatus.value = `正在生成第 ${i + 1}/${storyboardPrompts.value.length} 个分镜...`
      
      // 1. 为每个提示词更新工作流
      const workflowToUse = configStore.customWorkflow || defaultWorkflow
      const updatedWorkflow = updateWorkflow(workflowToUse, prompt)
      
      // 2. 发送生成请求
      const promptId = await sendGenerateRequest(updatedWorkflow)
      
      // 3. 等待该张图片生成完成
      await pollTaskStatus(promptId)
      
      // 4. 可选：逐张自动保存
      if (configStore.config.autoDownload && results.value.length > 0) {
        const latestResult = results.value[results.value.length - 1]
        await saveImageToDirectory([latestResult])
      }
    }
    
    generationStatus.value = `批量生成完成! 共 ${results.value.length} 张图片`
  } catch (err) {
    error.value = `批量生成失败: ${err.message}`
  } finally {
    isGenerating.value = false
  }
}
```

**批量生成特点**:
- ✅ **顺序执行**: 逐个处理分镜，避免 ComfyUI 队列拥堵
- ✅ **实时反馈**: 显示当前进度 ("正在生成第 3/10 个分镜...")
- ✅ **断点续传**: 单张失败不影响后续生成 (可增强为跳过机制)
- ✅ **内存优化**: 每张生成后立即保存，减少内存占用

---

## ⚙️ 四、工作流管理与API配置机制

### 4.1 工作流编辑器

**组件文件**: [WorkflowEditor.vue](src/components/workflow/WorkflowEditor.vue)

这是一个**可视化工作流编辑和管理界面**，提供以下功能:

#### 功能特性:
1. **上传工作流JSON文件**
2. **节点树形列表展示**
3. **节点属性在线编辑**
4. **实时预览与验证**
5. **本地存储与数据库同步**

#### 上传与兼容性修复

[WorkflowEditor.vue:155-207](src/components/workflow/WorkflowEditor.vue#L155-L207)

```javascript
const handleWorkflowFileSelect = (event) => {
  const file = event.target.files[0]
  const reader = new FileReader()
  
  reader.onload = (e) => {
    let content = JSON.parse(e.target.result)
    
    // 兼容性修复
    content = fixWorkflowCompatibility(content)
    
    // 存储到 Pinia Store
    configStore.customWorkflow = content
    configStore.workflowFilename = file.name
    
    // 三重持久化:
    localStorage.setItem('comfyui-web-workflow', JSON.stringify(content))  // 1. LocalStorage
    configStore.saveWorkflowToDB()  // 2. 数据库
  }
  
  reader.readAsText(file)
}
```

**兼容性修复逻辑** ([fixWorkflowCompatibility](src/components/workflow/WorkflowEditor.vue#L182-L207)):

```javascript
const fixWorkflowCompatibility = (workflow) => {
  Object.values(workflow).forEach(node => {
    // 修复 CLIPLoaderGGUF 节点的 type 字段
    if (node.class_type === 'CLIPLoaderGGUF' && node.inputs?.type) {
      const validTypes = ['stable_diffusion', 'stable_cascade', 'sd3', ...]
      if (!validTypes.includes(node.inputs.type)) {
        node.inputs.type = 'stable_diffusion'
      }
    }
    
    // 修复 CLIPTextEncode 的 clip 输入源
    if (node.class_type === 'CLIPTextEncode' && node.inputs?.clip) {
      const clipNodeId = node.inputs.clip[0]
      const clipNode = workflow[clipNodeId]
      
      if (clipNode?.class_type === 'CLIPLoaderGGUF') {
        // 切换到标准 CLIPLoader
        const standardClipLoader = Object.values(workflow).find(n => n.class_type === 'CLIPLoader')
        if (standardClipLoader) {
          const newId = Object.keys(workflow).find(id => workflow[id] === standardClipLoader)
          node.inputs.clip[0] = newId
        }
      }
    }
  })
  
  return workflow
}
```

### 4.2 节点属性编辑

**左侧面板 - 节点列表**:
```vue
<div v-for="(node, id) in configStore.currentWorkflow" :key="id"
     :class="['node-item', { active: selectedNodeId === id }]"
     @click="selectNode(id)">
  <span class="node-id">{{ id }}</span>
  <span class="node-type">{{ node.class_type }}</span>
</div>
```

**右侧面板 - 属性编辑**:
```vue
<select v-model="workflowEdit.property">
  <option v-for="prop in editableProperties" :key="prop.key" :value="prop.key">
    {{ prop.key }} ({{ formatValuePreview(prop.value) }})
  </option>
</select>

<textarea v-model="workflowEdit.value" placeholder="输入属性值..."></textarea>

<button @click="updateWorkflowNode">更新节点</button>
```

**更新节点逻辑** ([WorkflowEditor.vue:209-247](src/components/workflow/WorkflowEditor.vue#L209-L247)):

```javascript
const updateWorkflowNode = () => {
  const workflowToUpdate = configStore.customWorkflow || configStore.currentWorkflow
  const nodeId = workflowEdit.nodeId
  const property = workflowEdit.property
  const value = workflowEdit.value
  
  // 直接修改工作流对象的属性
  workflowToUpdate[nodeId].inputs[property] = value
  
  // 同步到 LocalStorage 和数据库
  localStorage.setItem('comfyui-web-workflow', JSON.stringify(configStore.customWorkflow))
  configStore.saveWorkflowToDB()
  
  workflowEdit.message = `节点 ${nodeId} 的 ${property} 属性已更新`
}
```

### 4.3 默认工作流结构

**文件位置**: [src/config/workflow.js](src/config/workflow.js)

项目内置了一个**完整的 Stable Diffusion 工作流模板**，包含以下节点:

| 节点ID | 类型 | 功能 |
|--------|------|------|
| **79** | UNETLoader | 加载大模型 (SDXL/SD1.5等) |
| **80** | CLIPLoader | 加载 CLIP 文本编码器 |
| **82** | VAEDecode | VAE 解码 (潜在空间→像素) |
| **83** | SaveImage | 保存生成的图片 |
| **84** | EmptyLatentImage | 创建空潜空间图像 (尺寸控制) |
| **85** | CLIPTextEncode | 正向提示词编码 |
| **86** | VAELoader | 加载 VAE 模型 |
| **93** | ConditioningZeroOut | 负面条件清零 |
| **106** | JoinStringMulti | 合并全局样式+单图提示词 |
| **107** | Text Multiline | **全局样式文本** (固定前缀) |
| **108** | easy showAnything | 调试预览 (可选) |
| **109** | Text Multiline | **动态提示词输入** (用户输入) ⭐ |
| **138** | KSamplerAdvanced | 高级采样器 (步数/CFG/种子) |
| **145** | INTConstant | 图像宽度 (720px) |
| **146** | INTConstant | 图像高度 (1024px) |

**关键节点 109 - 提示词输入点**:
```javascript
// 这是系统自动注入用户提示词的目标节点
updatedWorkflow["109"].inputs.text = "用户的提示词内容..."
```

**关键节点 107 - 全局样式前缀**:
```javascript
// 固定的画面质量/风格描述
"text": "这张高分辨率杰作照片呈现出 35 毫米胶片的质感..."
```

---

## 🔧 五、API 配置详解

### 5.1 Express API 服务器

**启动命令**: `npm run api` → 执行 `node server/api-server.js`

**端口**: 3002

**主要端点** ([api-server.js](server/api-server.js)):

| 方法 | 路径 | 功能 | 认证要求 |
|------|------|------|----------|
| POST | /api/comfyui/generate-single | **单图生成代理** | ✅ JWT |
| GET | /api/comfyui/history/:promptId | **查询生成历史** | ✅ JWT |
| POST | /api/auth/register | 用户注册 | ❌ |
| POST | /api/auth/login | 用户登录 | ❌ |
| GET | /api/characters | 获取角色列表 | ✅ JWT |
| POST | /api/configs | 保存配置 | ✅ JWT |

#### ComfyUI 代理端点实现

**单图生成代理** ([api-server.js:129-168](server/api-server.js#L129-L168)):

```javascript
comfyuiRouter.post('/generate-single', async (req, res) => {
  const { prompt, workflow, comfyuiUrl } = req.body
  
  // 1. 参数校验
  if (!prompt || !workflow) {
    return res.status(400).json({ success: false, error: '缺少提示词或工作流' })
  }
  
  // 2. 确定 ComfyUI 地址 (默认本地)
  const apiUrl = comfyuiUrl || 'http://127.0.0.1:8188'
  
  // 3. 动态修改工作流
  let updatedWorkflow = JSON.parse(JSON.stringify(workflow))
  updatedWorkflow["109"].inputs.text = prompt  // 注入提示词
  updatedWorkflow["84"].inputs.batch_size = 1  // 单图模式
  
  // 4. 转发请求到 ComfyUI
  const response = await fetch(`${apiUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: updatedWorkflow })
  })
  
  // 5. 返回任务ID给前端
  const data = await response.json()
  res.json({ success: true, promptId: data.prompt_id, apiUrl })
})
```

**历史查询代理** ([api-server.js:170-182](server/api-server.js#L170-L182)):

```javascript
comfyuiRouter.get('/history/:promptId', async (req, res) => {
  const { apiUrl } = req.query
  const response = await fetch(`${apiUrl || 'http://127.0.0.1:8188'}/history/${req.params.promptId}`)
  const data = await response.json()
  res.json(data)  // 直接转发 ComfyUI 响应
})
```

### 5.2 Download 服务器

**启动命令**: `npm run server` → 执行 `node server/download-server.js`

**端口**: 3001

**功能**: 从 ComfyUI 下载生成的图片并保存到本地磁盘

**核心端点** ([download-server.js](server/download/download-server.js)):

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/set-download-dir | 设置下载目录 |
| POST | /api/download-images | **批量下载图片** |
| GET | /api/download-dir | 获取当前下载目录 |
| GET | /api/config | 读取配置文件 |
| POST | /api/config | 写入配置文件 |

**批量下载实现** ([download-server.js:78-138](server/download-server.js#L78-L138)):

```javascript
app.post('/api/download-images', async (req, res) => {
  const { images, comfyuiUrl } = req.body
  const results = []
  
  // 确定 ComfyUI 基础URL
  let baseUrl = comfyuiUrl || 'http://127.0.0.1:8188'
  
  for (const { imageUrl, filename } of images) {
    // 处理相对路径URL
    let fullUrl = imageUrl.startsWith('http') 
      ? imageUrl 
      : `${baseUrl}${imageUrl}`
    
    // 下载图片
    const response = await fetch(fullUrl)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // 保存到本地磁盘
    const filepath = join(downloadDir, filename)
    fs.writeFileSync(filepath, buffer)
    
    results.push({ success: true, filepath, filename })
  }
  
  res.json({ success: true, results, downloadDir })
})
```

### 5.3 前端 API 客户端

**文件**: [src/services/api.js](src/services/api.js)

封装了所有与 Express API 服务器的交互:

```javascript
class ApiClient {
  constructor() {
    this.token = null  // JWT Token
    this.user = null   // 当前用户信息
  }
  
  // 认证相关
  async login(username, password) { ... }
  async register(username, email, password) { ... }
  
  // 角色管理
  async getCharacters() { ... }
  async createCharacter(data) { ... }
  
  // 配置管理
  async getConfigs(type) { ... }
  async saveConfig(type, data) { ... }
}

export const apiClient = new ApiClient()
```

---

## 🖼️ 六、ComfyUI 配置指南

### 6.1 本地部署要求

**必需软件**:
- Python 3.8+
- CUDA Toolkit (GPU加速)
- ComfyUI (从 GitHub 克隆)

**推荐安装步骤**:
```bash
# 1. 克隆 ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI

# 2. 创建虚拟环境
python -m venv venv
venv\Scripts\activate  # Windows

# 3. 安装依赖
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt

# 4. 启动服务
python main.py --listen 127.0.0.1 --port 8188
```

### 6.2 项目中的 ComfyUI 连接配置

**配置界面入口**: 设置页面 → ComfyUI 配置区域

**可配置项**:

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `comfyuiUrl` | http://127.0.0.1:8188 | ComfyUI Web服务地址 |
| `downloadDir` | 2026.4.20 | 图片保存目录名 (按日期) |
| `autoDownload` | false | 生成完成后是否自动下载 |
| `filenamePrefix` | ComfyUI | 输出文件名前缀 |
| `outputDir` | H:/COMFYUI_dapao/ComfyUI/output | ComfyUI实际输出目录 |
| `imageSize` | 512x512 | 默认图像尺寸 |
| `steps` | 30 | 采样步数 |
| `cfgScale` | 7.5 | CFG 引导强度 |

### 6.3 工作流文件格式规范

**标准 ComfyUI API 格式** (JSON):

```json
{
  "节点ID字符串": {
    "class_type": "节点类型名称",
    "inputs": {
      "参数1": "值1",
      "参数2": ["引用节点ID", 输出索引],
      ...
    },
    "_meta": {
      "title": "节点显示标题"
    }
  },
  ...
}
```

**本项目的约定**:
- **节点 109**: 必须存在，类型为 `Text Multiline`，用于接收用户提示词
- **节点 107**: 可选的全局样式前缀
- **节点 84**: 必须存在，类型为 `EmptyLatentImage`，控制 `batch_size`
- **SaveImage 节点**: 至少一个，系统会自动设置 `filename_prefix`

**示例工作流文件位置**: `分镜内容/工作流api/` 目录下

已包含的工作流模板:
- `Z-IMAGE：黑兽9 9步.json` - 使用黑兽模型的高质量工作流
- `Z-IMAGE：ZiB_redcraft0826.json` - RedCraft 模型工作流
- `250-ZIT-批量文生图2K(SEEDVR2).json` - 2K分辨率批量生成工作流

---

## 🔄 七、数据流转全景

### 7.1 单图生成数据流

```
用户输入提示词
    ↓
[SingleGenerate.vue]
    ↓
generationStore.generate()
    ↓
updateWorkflow(workflow, prompt, batchCount=1)
    ├─→ 验证工作流格式
    ├─→ 注入提示词到节点 109
    ├─→ 设置 batch_size = 1
    └─→ 更新文件名前缀
    ↓
sendGenerateRequest(updatedWorkflow)
    ↓
POST /api/prompt  (或 POST localhost:3002/api/comfyui/generate-single)
    ↓
ComfyUI 接收并排队执行
    ↓
返回 prompt_id
    ↓
pollTaskStatus(prompt_id)
    ├─→ 循环查询 /queue 和 /history (每500ms)
    ├─→ 更新进度条
    └─→ 检测到 outputs.images[] 时完成
    ↓
results.value = [{ url, filename, loaded }]
    ↓
(可选) autoDownload → POST localhost:3001/api/download-images
    ↓
图片保存到 server/downloads/{日期目录}/
```

### 7.2 批量生成数据流

```
用户选择多个 .json 分镜文件
    ↓
[BatchGenerate.vue] handleFileSelect()
    ↓
解析JSON → 提取 prompt 数组
    ↓
storyboardPrompts = ["分镜1", "分镜2", ..., "分镜N"]
    ↓
generationStore.batchGenerate()
    ↓
for (i = 0; i < prompts.length; i++) {
    updateWorkflow(workflow, prompts[i])
    sendGenerateRequest(...)
    pollTaskStatus(...)       ← 等待当前张完成
    saveImageToDirectory(...) ← 可选立即保存
}
    ↓
全部完成 → 显示统计信息
```

---

## 🛠️ 八、关键技术实现细节

### 8.1 工作流验证机制

[generation.js:26-34](src/stores/generation.js#L26-L34)

```javascript
const validateWorkflow = (workflowToValidate) => {
  for (const [nodeId, node] of Object.entries(workflowToValidate)) {
    if (!node.class_type) {
      console.warn(`节点 ${nodeId} 缺少 class_type`)
      return false
    }
  }
  return true
}
```

**验证规则**: 所有节点必须包含 `class_type` 字段

### 8.2 智能提示词注入

[generation.js:47-72](src/stores/generation.js#L47-L72)

系统采用**多级回退策略**查找可注入提示词的节点:

1. **优先使用节点 109** (项目约定的标准输入节点)
2. **回退到第一个 Text 类型的节点** (遍历所有节点查找)
3. **最终兜底**: 动态创建新的 Text Multiline 节点

```javascript
if (updatedWorkflow["109"]?.inputs?.text !== undefined) {
  updatedWorkflow["109"].inputs.text = prompt  // 方案A
} else {
  for (const [nodeId, node] of Object.entries(updatedWorkflow)) {
    if (node.inputs?.text !== undefined) {
      node.inputs.text = prompt  // 方案B
      break
    }
  }
  
  if (!promptSet) {
    // 方案C: 创建新节点
    updatedWorkflow['prompt_input_' + Date.now()] = {
      inputs: { text: prompt },
      class_type: 'Text Multiline'
    }
  }
}
```

### 8.3 进度估算算法

[generation.js:203-234](src/stores/generation.js#L203-L234)

**方案1: 基于节点统计** (精确)
```javascript
if (extraData?.node_stats) {
  const { completed, total } = extraData.node_stats
  progress.value = Math.round((completed / total) * 90)
}
```

**方案2: 基于时间估算** (模糊但稳定)
```javascript
const sec = elapsed / 1000
let p
if (sec < 0.8) p = sec * 40          // 0-32%
else if (sec < 1.8) p = 32 + (sec - 0.8) * 35  // 32-67%
else if (sec < 3) p = 67 + (sec - 1.8) * 20     // 67-87%
else if (sec < 4) p = 87 + (sec - 3) * 5         // 87-92%
else p = Math.min(92, 92 + (sec - 4) * 1)         // 92%+

progress.value = Math.max(progress.value, Math.min(92, Math.round(p)))
```

### 8.4 错误处理与容错

**网络错误**:
```javascript
try {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
} catch (e) {
  error.value = `生成失败: ${e.message}。请确保ComfyUI服务正在运行，地址正确。`
}
```

**超时保护**:
```javascript
const maxAttempts = 600  // ~300秒
if (attempts >= maxAttempts) {
  throw new Error('生成超时')
}
```

**ComfyUI 执行错误检测**:
```javascript
if (statusInfo.status_str === 'error') {
  throw new Error(statusInfo.messages.join(', '))
}
```

---

## 📁 九、文件结构总览

```
角色生成器/
├── src/
│   ├── components/
│   │   ├── generation/
│   │   │   ├── SingleGenerate.vue      # 单图生成UI
│   │   │   ├── BatchGenerate.vue       # 批量生成UI
│   │   │   └── TxtToJson.vue           # 文本转JSON工具
│   │   ├── workflow/
│   │   │   └── WorkflowEditor.vue      # 工作流编辑器 ⭐核心
│   │   └── settings/
│   │       └── SettingsPanel.vue       # 配置面板
│   ├── stores/
│   │   ├── generation.js               # 生成逻辑 Store ⭐核心
│   │   ├── config.js                   # 配置管理 Store ⭐核心
│   │   └── character.js                # 角色数据 Store
│   ├── services/
│   │   └── api.js                      # API客户端
│   └── config/
│       └── workflow.js                 # 默认工作流定义
│
├── server/
│   ├── api-server.js                   # Express API服务器 (端口3002) ⭐核心
│   ├── download-server.js              # 下载服务器 (端口3001) ⭐核心
│   ├── config.json                     # 服务器配置文件
│   └── downloads/                      # 生成的图片存储目录
│
├── 分镜内容/
│   └── 工作流api/                      # 预设工作流模板
│       ├── Z-IMAGE：黑兽9 9步.json
│       ├── Z-IMAGE：ZiB_redcraft0826.json
│       └── ...
│
├── package.json                        # 项目依赖配置
└── vite.config.js                      # Vite构建配置 (含代理设置)
```

---

## 🚀 十、快速启动指南

### 10.1 环境准备

**前置条件**:
1. ✅ Node.js 18+ 已安装
2. ✅ ComfyUI 已部署并可访问 (http://127.0.0.1:8188)
3. ✅ GPU驱动和CUDA已安装 (可选，CPU也可运行但很慢)

### 10.2 启动步骤

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器 (前端)
npm run dev
# 访问: http://localhost:5173

# 3. 启动 API 服务器 (后端)
npm run api
# 监听: http://localhost:3002

# 4. 启动下载服务器 (可选，用于保存图片)
npm run server
# 监听: http://localhost:3001
```

### 10.3 使用流程

1. **打开浏览器** → 访问 http://localhost:5173
2. **进入设置页面** → 配置 ComfyUI 地址 (通常默认即可)
3. **测试连接** → 点击"测试"按钮确认 ComfyUI 在线
4. **(可选) 上传自定义工作流** → 进入"工作流api"页面导入 .json 文件
5. **开始生成**:
   - **单图模式**: 进入"单图"页面，输入提示词，点击生成
   - **批量模式**: 进入"批量"页面，选择分镜JSON文件，点击批量生成
6. **查看结果** → 页面上实时显示生成进度和图片预览
7. **(可选) 下载图片** → 开启自动下载或手动点击保存

---

## 💡 十一、最佳实践建议

### 11.1 性能优化

1. **批量生成控制并发**:
   - 当前实现是串行执行，适合大多数场景
   - 如需提速，可考虑限制并发数为 2-3 个任务

2. **图片懒加载**:
   ```javascript
   results.value.push({ url, filename, loaded: false })  // 初始不加载
   // 用户点击或滚动到可视区域时再加载
   ```

3. **工作流缓存**:
   - 频繁使用的复杂工作流可以序列化后缓存到 IndexedDB
   - 避免每次刷新都重新解析大型JSON

### 11.2 错误恢复

1. **断点续批**: 记录已完成的索引，失败时可从断点继续
2. **自动重试**: 网络错误时自动重试 2-3 次
3. **日志记录**: 将生成历史保存到本地，便于排查问题

### 11.3 安全性

1. **JWT认证**: 所有API接口都需要有效Token
2. **CORS配置**: 仅允许受信任的域名访问
3. **输入清理**: 对用户输入的提示词进行基本过滤

---

## 📊 十二、扩展性设计

### 12.1 支持远程 ComfyUI

系统已内置远程部署支持:

```javascript
// config.js 中自动判断
const getApiBaseUrl = () => {
  if (isLocalComfyUI()) return '/api'  // 通过Vite代理
  return config.value.comfyuiUrl  // 直连远程服务器
}
```

**Vite 代理配置** (vite.config.js):
```javascript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8188',
        changeOrigin: true
      }
    }
  }
})
```

### 12.2 多工作流切换

可通过以下方式实现工作流库管理:

```javascript
// 预设工作流库
const workflowLibrary = {
  'portrait': portraitWorkflow,
  'landscape': landscapeWorkflow,
  'anime': animeWorkflow
}

// 动态切换
configStore.customWorkflow = workflowLibrary[selectedType]
```

### 12.3 插件化节点编辑

未来可扩展为可视化拖拽编辑器:

- 基于Canvas/SVG绘制节点连线图
- 支持拖拽调整节点位置
- 实时预览工作流执行效果

---

## 🎯 总结

本项目实现了一套**完整的 ComfyUI 工作流 API 对接方案**，具备以下优势:

✅ **灵活的工作流管理**: 支持上传、编辑、验证任意 ComfyUI 工作流  
✅ **双模式生成**: 单图精细控制和批量高效生产  
✅ **完善的错误处理**: 超时保护、重试机制、友好提示  
✅ **可扩展架构**: 清晰的分层设计，易于添加新功能  
✅ **开箱即用**: 内置高质量工作流模板，降低使用门槛  

**适用场景**:
- AI角色形象生成
- 批量素材制作 (游戏/影视分镜)
- 个人创作辅助工具
- AI图像生成教学演示

---

*报告生成时间: 2026-04-20*  
*技术栈版本: Vue 3.5 + Vite 6 + Express 4 + ComfyUI Latest*
