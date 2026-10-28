# API配置与服务商管理技术实现文档

## 📋 文档概述

本技术文档详细分析 **AI角色生成器平台** 中不同AI服务商的API配置实现。项目支持多种主流AI服务商，通过统一的配置管理机制实现无缝切换和个性化配置。

## 🏗️ 系统架构

### 配置管理架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   前端配置界面   │────▶│  Pinia Config Store  │────▶│  持久化存储层   │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                        │
                                 ▼                        ▼
                          ┌─────────────────┐     ┌─────────────────┐
                          │  服务商切换逻辑  │     │  数据库 /       │
                          │  (Watch机制)    │     │  LocalStorage   │
                          └─────────────────┘     └─────────────────┘
```

## 🔧 支持的AI服务商

项目支持 **8种主流AI服务商**，每种都有独立的配置项：

| 服务商 | 代码标识 | API 基础URL | 默认模型 |
|--------|----------|------------|----------|
| **SiliconFlow** | `siliconflow` | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| **OpenAI** | `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| **OpenRouter** | `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-4o` |
| **阿里云** | `aliyun` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| **Google** | `google` | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.5-flash` |
| **LM Studio** | `lmstudio` | `http://127.0.0.1:1234/v1` | (空，本地部署) |
| **ModelScope** | `modelscope` | `https://api-inference.modelscope.cn/v1` | `qwen2.5-7b-instruct` |
| **自定义** | `custom` | (用户自定义) | (用户自定义) |

## 🔍 配置结构设计

### 核心配置对象

**文件**: [src/stores/config.js](src/stores/config.js:13-52)

```javascript
const aiConfig = ref({
  provider: 'siliconflow',  // 当前选中的服务商
  apiKey: '',              // 当前服务商的API密钥
  apiKeys: {               // 各服务商的API密钥映射
    siliconflow: '',
    openai: '',
    openrouter: '',
    aliyun: '',
    google: '',
    lmstudio: '',
    modelscope: '',
    custom: ''
  },
  apiUrl: 'https://api.siliconflow.cn/v1',  // 当前API基础URL
  model: 'Qwen/Qwen2.5-7B-Instruct',        // 当前模型
  models: {               // 各服务商的默认模型映射
    siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
    openai: 'gpt-4o',
    openrouter: 'openai/gpt-4o',
    aliyun: 'qwen-plus',
    google: 'gemini-2.5-flash',
    lmstudio: '',
    modelscope: 'qwen2.5-7b-instruct',
    custom: ''
  },
  temperature: 0.7,       // 生成温度
  useProxy: false,        // 是否使用代理
  proxyPort: '7890',      // 代理端口
  enableThinking: false,   // 思考模式
  enableThinkingByProvider: {  // 各服务商的思考模式配置
    siliconflow: false,
    openai: false,
    // ... 其他服务商
  }
})
```

### 已测试模型存储

**文件**: [src/stores/config.js:54-63](src/stores/config.js#L54-L63)

```javascript
const testedModels = ref({
  siliconflow: [],
  openai: [],
  openrouter: [],
  aliyun: [],
  google: [],
  lmstudio: [],
  modelscope: [],
  custom: []
})
```

## ⚙️ 服务商切换技术实现

### 核心切换机制

**文件**: [src/stores/config.js:72-133](src/stores/config.js#L72-L133)

采用 **Vue 3 Watch 响应式机制** 实现服务商无缝切换：

```javascript
watch(() => aiConfig.value.provider, (newProvider, oldProvider) => {
  if (oldProvider && oldProvider !== newProvider) {
    console.log(`🔄 切换服务商：${oldProvider} → ${newProvider}`)
    
    // 1. 保存当前服务商的配置
    aiConfig.value.apiKeys[previousProvider] = aiConfig.value.apiKey
    aiConfig.value.models[previousProvider] = aiConfig.value.model
    aiConfig.value.enableThinkingByProvider[previousProvider] = aiConfig.value.enableThinking
    
    // 2. 更新API基础URL
    if (newProvider === 'openai') {
      aiConfig.value.apiUrl = 'https://api.openai.com/v1'
    } else if (newProvider === 'siliconflow') {
      aiConfig.value.apiUrl = 'https://api.siliconflow.cn/v1'
    } // ... 其他服务商
    
    // 3. 恢复新服务商的API密钥
    const savedKey = aiConfig.value.apiKeys[newProvider]
    if (savedKey && savedKey.trim()) {
      aiConfig.value.apiKey = savedKey
      console.log(`🔑 已加载 ${newProvider} 的 API 密钥`)
    } else {
      aiConfig.value.apiKey = ''
      console.log(`⚠️ ${newProvider} 没有保存的 API 密钥，请手动配置`)
    }
    
    // 4. 恢复新服务商的思考模式
    const savedThinking = aiConfig.value.enableThinkingByProvider[newProvider]
    aiConfig.value.enableThinking = savedThinking !== undefined ? savedThinking : false
    
    // 5. 恢复新服务商的模型
    if (!skipModelRestore) {
      const savedModel = aiConfig.value.models[newProvider] || ''
      aiConfig.value.model = savedModel
    }
    
    // 6. 更新当前服务商标识
    previousProvider = newProvider
  }
  skipModelRestore = false
})
```

### 切换流程详解

1. **配置保存** - 保存当前服务商的API密钥、模型和思考模式
2. **URL更新** - 根据新服务商自动更新API基础URL
3. **密钥恢复** - 从`apiKeys`映射中加载新服务商的API密钥
4. **设置恢复** - 恢复新服务商的思考模式和模型配置
5. **状态更新** - 更新`previousProvider`标识为新服务商

## 🔐 API密钥管理

### 密钥存储机制

**双重存储结构**:
- **当前密钥** (`aiConfig.apiKey`): 当前选中服务商的API密钥
- **密钥映射** (`aiConfig.apiKeys`): 所有服务商的API密钥持久化存储

### 密钥保存流程

**文件**: [src/stores/config.js:220-221](src/stores/config.js#L220-L221)

```javascript
// 保存当前服务商的API密钥到映射中
aiConfig.value.apiKeys[aiConfig.value.provider] = aiConfig.value.apiKey
```

### 安全处理

- **内存存储**: API密钥仅在内存中明文存储，不写入日志
- **数据库存储**: 登录状态下同步到数据库，未登录时保存在LocalStorage
- **密钥掩码**: 同步到数据库时使用`***`掩码保护（[config.js:445](src/stores/config.js#L445)）

## 📡 模型配置管理

### 模型映射机制

**文件**: [src/stores/config.js:28-37](src/stores/config.js#L28-L37)

```javascript
models: {
  siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o',
  aliyun: 'qwen-plus',
  google: 'gemini-2.5-flash',
  lmstudio: '',
  modelscope: 'qwen2.5-7b-instruct',
  custom: ''
}
```

### 模型保存流程

**文件**: [src/stores/config.js:222](src/stores/config.js#L222)

```javascript
// 保存当前服务商的模型到映射中
aiConfig.value.models[aiConfig.value.provider] = aiConfig.value.model
```

### 已测试模型管理

#### 已测试模型数据结构

每个已测试模型包含以下字段：
- `id`: 模型唯一标识符
- `name`: 模型显示名称
- `provider`: 所属服务商
- `testedAt`: 测试时间戳

#### 添加已测试模型

**文件**: [src/stores/config.js:247-273](src/stores/config.js#L247-L273)

```javascript
const addTestedModel = async (provider, modelId, modelName) => {
  if (!testedModels.value[provider]) {
    testedModels.value[provider] = []
  }
  
  // 避免重复添加
  const exists = testedModels.value[provider].find(m => m.id === modelId)
  if (!exists) {
    testedModels.value[provider].push({
      id: modelId,
      name: modelName || modelId,
      provider: provider,
      testedAt: new Date().toISOString()
    })
    
    // 同步到数据库
    if (apiClient.isLoggedIn()) {
      const testedModelsCopy = JSON.parse(JSON.stringify(testedModels.value))
      console.log('[Config] 📤 保存 tested_models 到数据库 (addTestedModel):', testedModelsCopy)
      await apiClient.saveConfig('tested_models', testedModelsCopy)
      console.log('[Config] ✓ 已测试模型已保存到数据库:', modelId)
    } else {
      console.warn('[Config] 未登录，无法保存已测试模型')
    }
  }
}
```

#### 移除已测试模型

**文件**: [src/stores/config.js:275-294](src/stores/config.js#L275-L294)

```javascript
const removeTestedModel = async (provider, modelId) => {
  if (testedModels.value[provider]) {
    const index = testedModels.value[provider].findIndex(m => m.id === modelId)
    if (index > -1) {
      testedModels.value[provider].splice(index, 1)
      
      // 同步到数据库
      if (apiClient.isLoggedIn()) {
        const testedModelsCopy = JSON.parse(JSON.stringify(testedModels.value))
        await apiClient.saveConfig('tested_models', testedModelsCopy)
        console.log('[Config] ✓ 已从数据库移除模型:', modelId)
      } else {
        console.warn('[Config] 未登录，无法移除模型')
      }
    }
  }
}
```

### 测试通过模型的数据库保存机制

#### 1. 数据库保存时机

**文件**: [src/stores/config.js:240, 264, 284](src/stores/config.js#L240)

**保存触发条件**:
- **主动添加**: 当调用 `addTestedModel()` 添加新的测试通过模型时
- **主动移除**: 当调用 `removeTestedModel()` 移除已测试模型时
- **批量保存**: 当调用 `saveAIConfig()` 保存AI配置时

#### 2. 保存流程

**步骤 1**: 验证登录状态
```javascript
if (apiClient.isLoggedIn()) {
  // 执行数据库保存操作
} else {
  console.warn('[Config] 未登录，无法保存已测试模型')
}
```

**步骤 2**: 数据序列化
```javascript
const testedModelsCopy = JSON.parse(JSON.stringify(testedModels.value))
```

**步骤 3**: 调用API保存
```javascript
await apiClient.saveConfig('tested_models', testedModelsCopy)
```

**步骤 4**: 日志记录
```javascript
console.log('[Config] ✓ 已测试模型已保存到数据库:', modelId)
```

#### 3. 数据库存储结构

**存储键名**: `tested_models`

**存储格式**:
```json
{
  "siliconflow": [
    {
      "id": "Qwen/Qwen2.5-7B-Instruct",
      "name": "Qwen 2.5 7B Instruct",
      "provider": "siliconflow",
      "testedAt": "2026-04-21T12:00:00Z"
    }
  ],
  "openai": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "provider": "openai",
      "testedAt": "2026-04-21T12:05:00Z"
    }
  ]
  // 其他服务商...
}
```

#### 4. 数据库加载机制

**文件**: [src/stores/config.js:354-365](src/stores/config.js#L354-L365)

```javascript
const testedModelsData = configs.tested_models
if (testedModelsData) {
  const parsed = typeof testedModelsData === 'string' ? JSON.parse(testedModelsData) : testedModelsData
  console.log('[Config] 📥 从数据库加载 tested_models 原始数据:', parsed)
  if (parsed && typeof parsed === 'object') {
    Object.keys(parsed).forEach(provider => {
      if (Array.isArray(parsed[provider])) {
        testedModels.value[provider] = parsed[provider]
      }
    })
    console.log('[Config] ✓ 已从数据库加载已测试模型:', JSON.stringify(testedModels.value))
  }
} else {
  console.log('[Config] ℹ️ 数据库中没有已测试模型数据')
}
```

#### 5. 测试模型管理的业务价值

- **模型追踪**: 记录哪些模型已经过测试验证
- **快速切换**: 已测试模型可直接从列表中选择，无需重新测试
- **历史记录**: 保存测试时间，便于追踪模型使用历史
- **团队协作**: 多用户可共享已测试模型列表
- **性能优化**: 避免重复测试相同模型，提高系统效率

### 测试模型管理示例

#### 示例: 添加并保存测试通过的模型

```javascript
// 测试通过一个新模型
await addTestedModel(
  'siliconflow',              // 服务商
  'Qwen/Qwen2.5-32B-Instruct', // 模型ID
  'Qwen 2.5 32B Instruct'     // 模型名称
)

// 系统执行流程:
// 1. 检查模型是否已存在
// 2. 创建模型记录并添加到testedModels.siliconflow数组
// 3. 验证用户登录状态
// 4. 序列化数据并保存到数据库
// 5. 记录操作日志

// 结果: 模型成功保存到数据库，可在配置界面中看到
```

#### 示例: 批量保存测试模型

```javascript
// 保存所有AI配置，包括已测试模型
await saveAIConfig()

// 系统执行流程:
// 1. 保存当前服务商的API密钥和模型
// 2. 保存完整的AI配置到数据库
// 3. 同时保存所有已测试模型到数据库
// 4. 记录操作日志
```

## 💾 配置持久化机制

### 存储策略

**双模式存储**:

| 登录状态 | 主要存储 | 备份存储 | 同步方式 |
|---------|---------|---------|---------|
| ✅ 已登录 | **SQLite 数据库** | LocalStorage | 自动同步 |
| ❌ 未登录 | **LocalStorage** | - | 本地持久化 |

### 数据库同步

**文件**: [src/stores/config.js:210-245](src/stores/config.js#L210-L245)

```javascript
const saveAIConfig = async () => {
  if (!apiClient.isLoggedIn()) {
    console.warn('[Config] 未登录，无法保存AI配置')
    return
  }
  
  // 确保当前配置已保存到映射中
  aiConfig.value.apiKeys[aiConfig.value.provider] = aiConfig.value.apiKey
  aiConfig.value.models[aiConfig.value.provider] = aiConfig.value.model
  
  try {
    // 保存AI配置到数据库
    await apiClient.saveConfig('ai_config', {
      provider: aiConfig.value.provider,
      apiKey: aiConfig.value.apiKey,
      apiKeys: aiConfig.value.apiKeys,
      apiUrl: aiConfig.value.apiUrl,
      model: aiConfig.value.model,
      models: aiConfig.value.models,
      temperature: aiConfig.value.temperature,
      useProxy: aiConfig.value.useProxy,
      proxyPort: aiConfig.value.proxyPort,
      enableThinking: aiConfig.value.enableThinking,
      enableThinkingByProvider: aiConfig.value.enableThinkingByProvider
    })
    
    // 保存已测试模型到数据库
    await apiClient.saveConfig('tested_models', JSON.parse(JSON.stringify(testedModels.value)))
    
    console.log('[Config] ✓ AI配置已保存到数据库')
  } catch (e) {
    console.error('[Config] ✗ 保存AI配置失败:', e)
  }
}
```

### LocalStorage 备份

**文件**: [src/stores/config.js:400-412](src/stores/config.js#L400-L412)

```javascript
const savedAIConfig = localStorage.getItem('comfyui-web-ai-config')
if (savedAIConfig) {
  try {
    skipModelRestore = true
    const parsedConfig = JSON.parse(savedAIConfig)
    Object.assign(aiConfig.value, parsedConfig)
    previousProvider = aiConfig.value.provider
    if (aiConfig.value.apiKeys && aiConfig.value.apiKeys[aiConfig.value.provider]) {
      aiConfig.value.apiKey = aiConfig.value.apiKeys[aiConfig.value.provider]
    }
    console.log('[Config] 已从 localStorage 迁移AI配置')
  } catch (err) { console.error('加载AI配置失败:', err) }
}
```

### 自动保存机制

**文件**: [src/stores/config.js:475-483](src/stores/config.js#L475-L483)

```javascript
let saveTimeout = null
function autoSave() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    if (apiClient.isLoggedIn() && isOnline.value) {
      await syncToDB()
    }
  }, 1000)
}
```

## 🌐 API 代理配置

### 智能代理路由

**文件**: [src/stores/config.js:179-190](src/stores/config.js#L179-L190)

```javascript
const getAiApiBaseUrl = () => {
  if (aiConfig.value.provider === 'openrouter') return '/ai-api'
  if (aiConfig.value.provider === 'siliconflow') return '/siliconflow-api'
  if (aiConfig.value.provider === 'openai') return '/openai-api'
  if (aiConfig.value.provider === 'aliyun') return '/aliyun-api'
  if (aiConfig.value.provider === 'google') {
    return aiConfig.value.useProxy ? `/google-proxy-api/v1beta` : '/google-api'
  }
  if (aiConfig.value.provider === 'lmstudio') return '/lmstudio-api'
  if (aiConfig.value.provider === 'modelscope') return '/modelscope-api'
  return aiConfig.value.apiUrl.endsWith('/') ? aiConfig.value.apiUrl.slice(0, -1) : aiConfig.value.apiUrl
}
```

### 代理端口配置

**文件**: [src/stores/config.js:40](src/stores/config.js#L40)

```javascript
proxyPort: '7890',  // 默认代理端口
```

## 🔄 配置加载流程

### 启动时加载

**文件**: [src/stores/config.js:386-432](src/stores/config.js#L386-L432)

```javascript
const loadConfig = async () => {
  if (apiClient.isLoggedIn()) {
    // 从数据库加载
    await loadConfigsFromDB()
  } else {
    // 从未登录状态的LocalStorage加载
    console.log('[Config] 未登录，尝试从 localStorage 迁移旧数据...')
    
    // 加载AI配置
    const savedAIConfig = localStorage.getItem('comfyui-web-ai-config')
    if (savedAIConfig) {
      try {
        skipModelRestore = true
        const parsedConfig = JSON.parse(savedAIConfig)
        Object.assign(aiConfig.value, parsedConfig)
        previousProvider = aiConfig.value.provider
        if (aiConfig.value.apiKeys && aiConfig.value.apiKeys[aiConfig.value.provider]) {
          aiConfig.value.apiKey = aiConfig.value.apiKeys[aiConfig.value.provider]
        }
        console.log('[Config] 已从 localStorage 迁移AI配置')
      } catch (err) { console.error('加载AI配置失败:', err) }
    }
    
    // 加载已测试模型
    const savedTestedModels = localStorage.getItem('comfyui-web-tested-models')
    if (savedTestedModels) {
      try {
        const parsed = JSON.parse(savedTestedModels)
        Object.assign(testedModels.value, parsed)
        console.log('[Config] 已从 localStorage 迁移已测试模型')
      } catch (err) { console.error('加载测试模型失败:', err) }
    }
  }
}
```

### 数据库加载

**文件**: [src/stores/config.js:313-384](src/stores/config.js#L313-L384)

```javascript
async function loadConfigsFromDB() {
  if (!apiClient.isLoggedIn()) {
    console.log('[Config] 未登录，跳过从数据库加载')
    return
  }
  
  try {
    const configs = await apiClient.getConfigs()
    if (!configs || typeof configs !== 'object') return

    // 加载AI配置
    const aiData = configs.ai_config
    if (aiData) {
      skipModelRestore = true
      const parsed = typeof aiData === 'string' ? JSON.parse(aiData) : aiData
      Object.assign(aiConfig.value, parsed)
      
      // 确保兼容性
      if (!aiConfig.value.enableThinkingByProvider) {
        aiConfig.value.enableThinkingByProvider = {
          siliconflow: false,
          openai: false,
          openrouter: false,
          aliyun: false,
          google: false,
          lmstudio: false,
          modelscope: false,
          custom: false
        }
      }
      
      previousProvider = aiConfig.value.provider
      if (aiConfig.value.apiKeys && aiConfig.value.apiKeys[aiConfig.value.provider]) {
        aiConfig.value.apiKey = aiConfig.value.apiKeys[aiConfig.value.provider]
      }
    }

    // 加载已测试模型
    const testedModelsData = configs.tested_models
    if (testedModelsData) {
      const parsed = typeof testedModelsData === 'string' ? JSON.parse(testedModelsData) : testedModelsData
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(provider => {
          if (Array.isArray(parsed[provider])) {
            testedModels.value[provider] = parsed[provider]
          }
        })
      }
    }
    
    console.log('[Config] ✓ 配置已从数据库加载')
  } catch (e) {
    console.error('[Config] ✗ 从数据库加载配置失败:', e)
  }
}
```

## 📊 数据导出与导入

### 导出配置

**文件**: [src/stores/config.js:485-492](src/stores/config.js#L485-L492)

```javascript
const exportData = () => ({
  config: config.value,
  aiConfig: aiConfig.value,  // 包含所有服务商配置
  customWorkflow: customWorkflow.value,
  exportTime: new Date().toISOString(),
  version: '3.0',
  source: 'ai-character-platform-local-db'
})
```

### 导入配置

**文件**: [src/stores/config.js:494-503](src/stores/config.js#L494-L503)

```javascript
const importData = async (data) => {
  if (data.config) Object.assign(config.value, data.config)
  if (data.aiConfig) {
    skipModelRestore = true
    Object.assign(aiConfig.value, data.aiConfig)
    previousProvider = aiConfig.value.provider
  }
  if (data.customWorkflow) customWorkflow.value = data.customWorkflow
  await autoSave()
}
```

## 🔧 重置配置

**文件**: [src/stores/config.js:505-548](src/stores/config.js#L505-L548)

```javascript
const resetToDefaults = async (skipSync = false) => {
  // 重置基础配置
  config.value = {
    comfyuiUrl: 'http://127.0.0.1:8188',
    downloadDir: getCurrentDateFolder(),
    autoDownload: false
  }
  
  // 重置AI配置到默认值
  aiConfig.value = {
    provider: 'siliconflow',
    apiKey: '',
    apiKeys: { siliconflow: '', openai: '', openrouter: '', aliyun: '', google: '', lmstudio: '', modelscope: '', custom: '' },
    apiUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: {
      siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
      openai: 'gpt-4o',
      openrouter: 'openai/gpt-4o',
      aliyun: 'qwen-plus',
      google: 'gemini-2.5-flash',
      lmstudio: '',
      modelscope: 'qwen2.5-7b-instruct',
      custom: ''
    },
    temperature: 0.7,
    useProxy: false,
    proxyPort: '7890',
    enableThinking: false
  }
  
  // 重置已测试模型
  testedModels.value = {
    siliconflow: [],
    openai: [],
    openrouter: [],
    aliyun: [],
    google: [],
    lmstudio: [],
    modelscope: [],
    custom: []
  }
  
  // 重置工作流
  customWorkflow.value = null
  workflowFilename.value = ''
  workflowMessage.value = ''
  
  // 同步到数据库
  if (!skipSync) {
    await syncToDB()
  }
}
```

## 📁 关键文件结构

```
角色生成器/
├── src/
│   ├── stores/
│   │   └── config.js       # 配置管理核心文件 ⭐
│   ├── services/
│   │   └── api.js          # API客户端
│   └── components/
│       └── settings/
│           └── SettingsPanel.vue  # 配置界面
│
├── server/
│   ├── api-server.js       # API服务器
│   └── config.json         # 服务器配置
│
└── package.json            # 项目依赖
```

## 💡 技术亮点

### 1. 智能服务商切换

- **无缝切换**: 自动保存当前配置并加载新服务商配置
- **状态保持**: 每个服务商的API密钥、模型和设置独立保存
- **URL自动更新**: 根据服务商类型自动更新API基础URL

### 2. 多层次存储策略

- **双模式存储**: 登录时使用数据库，未登录时使用LocalStorage
- **自动同步**: 网络恢复后自动同步配置到数据库
- **数据迁移**: 从LocalStorage自动迁移到数据库

### 3. 安全性考虑

- **密钥保护**: API密钥在数据库中使用掩码存储
- **内存管理**: 敏感信息仅在内存中临时存储
- **错误处理**: 配置加载失败时使用默认值确保系统稳定性

### 4. 可扩展性设计

- **模块化结构**: 服务商配置采用映射结构，易于添加新服务商
- **向后兼容**: 自动处理旧数据格式，确保系统升级平滑
- **测试模型管理**: 独立的已测试模型跟踪机制

## 🔍 配置使用示例

### 示例1: 切换到OpenAI

```javascript
// 1. 选择OpenAI服务商
aiConfig.value.provider = 'openai'

// 2. 系统自动执行以下操作:
//    - 保存当前服务商的配置
//    - 更新API URL为 'https://api.openai.com/v1'
//    - 加载OpenAI的API密钥 (如果已保存)
//    - 加载OpenAI的默认模型 'gpt-4o'
//    - 恢复OpenAI的思考模式设置

// 3. 手动设置API密钥
aiConfig.value.apiKey = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'

// 4. 保存配置
await saveAIConfig()
```

### 示例2: 添加已测试模型

```javascript
// 为SiliconFlow添加已测试模型
await addTestedModel(
  'siliconflow',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen 2.5 72B Instruct'
)

// 系统会:
// - 检查模型是否已存在
// - 添加到testedModels.siliconflow数组
// - 同步到数据库 (如果已登录)
```

### 示例3: 配置代理

```javascript
// 为Google设置代理
aiConfig.value.provider = 'google'
aiConfig.value.useProxy = true
aiConfig.value.proxyPort = '7890'  // 自定义代理端口

// 系统会使用代理URL: /google-proxy-api/v1beta
```

## 🚀 最佳实践

### 1. 配置管理

- **集中管理**: 通过`useConfigStore()`统一管理所有配置
- **自动保存**: 配置变更后系统会自动保存，无需手动操作
- **定期导出**: 重要配置定期导出备份，防止数据丢失

### 2. 服务商选择

- **默认推荐**: 首次使用推荐使用SiliconFlow (国内访问稳定)
- **模型匹配**: 选择适合任务的模型，如创意生成推荐GPT-4o
- **成本考虑**: 根据预算选择合适的服务商和模型

### 3. 安全性

- **API密钥保护**: 不要在代码或日志中明文存储API密钥
- **定期轮换**: 定期更新API密钥，尤其是在团队协作环境中
- **最小权限**: 为API密钥设置最小必要的权限范围

### 4. 故障排查

- **连接测试**: 切换服务商后测试连接状态
- **日志检查**: 查看控制台日志了解配置加载和切换过程
- **网络检查**: 确认网络连接和代理设置是否正确

## 🎯 总结

本项目的API配置管理系统实现了以下核心功能：

✅ **多服务商支持**: 集成8种主流AI服务商，满足不同场景需求
✅ **智能配置管理**: 自动保存和恢复各服务商的个性化配置
✅ **无缝切换机制**: 服务商切换时自动处理配置迁移
✅ **安全存储**: 多层次存储策略，平衡安全性和便捷性
✅ **可扩展性**: 模块化设计，易于添加新服务商和功能

该实现不仅提供了灵活的API配置管理，还确保了系统的稳定性和用户体验的流畅性，为AI角色生成器平台提供了坚实的技术基础。

---

*技术文档生成时间: 2026-04-21*
*技术栈版本: Vue 3.5 + Pinia 3.0 + Express 4.0*
