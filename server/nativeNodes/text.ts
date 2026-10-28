/**
 * 文本 / LLM 域节点（原生实现）
 * 覆盖旧项目的领域节点：文本输入、文本显示、提示词规则、API服务商、文本处理、聊天
 */
import { getDatabase } from '../db'
import { LLMProviderRepo } from '../repositories/LLMProviderRepo'
import type { ExecContext, NativeNodeImpl } from '../registry/types'

let providerRepo: LLMProviderRepo | null = null
function getProviderRepo(): LLMProviderRepo {
  if (!providerRepo) providerRepo = new LLMProviderRepo(getDatabase())
  return providerRepo
}

function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/** 按 id 或名称解析服务商（旧工作流存的是名称，节点现在存 id） */
function resolveProvider(ref: unknown): any {
  const key = str(ref)
  if (!key) return null
  const repo = getProviderRepo()
  return (repo.findById(key) as any) || (repo.findAll() as any[]).find((p) => p.name === key) || null
}

/** API 服务商节点：选择已配置的 LLM 提供商，输出连接配置 */
export const apiProviderImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const p = resolveProvider(ctx.inputs.provider)
    if (!p) throw new Error(`未找到 API 服务商：${str(ctx.inputs.provider) || '(未选择)'}，请到「设置 → API 服务商」添加并启用`)
    return {
      result: [{
        provider_id: p.id,
        name: p.name,
        provider_type: p.provider_type,
        base_url: p.base_url,
        model: p.default_model
      }]
    }
  }
}

/** 文本处理：API服务商 + 提示词规则 + 文本输入 → LLM 处理后的文本 */
export const textProcessImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const providerId = str((ctx.inputs.api_config as { provider_id?: unknown } | undefined)?.provider_id ?? ctx.inputs.api_config ?? '')
    const rule = str(ctx.inputs.rule)
    const text = str(ctx.inputs.text)
    if (!providerId) throw new Error('未连接「API服务商」节点')
    const provider = resolveProvider(providerId)
    if (!provider) throw new Error(`找不到 API 服务商配置: ${providerId}`)

    const baseUrl = (provider.base_url || provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const model = str(ctx.inputs.model) || provider.default_model || provider.model || 'gpt-4o-mini'
    const systemPrompt = rule || '你是一名 helpful 的助手。'
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key || provider.apiKey || ''}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: Number(ctx.inputs.temperature ?? 0.7)
      })
    })
    if (!res.ok) throw new Error(`LLM API 错误 ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data?.choices?.[0]?.message?.content ?? ''
    return { result: [String(content)], ui: { text: [String(content)] } }
  }
}

/** 聊天节点：显示对话 + 输入发送（输出为最新回复） */
export const chatImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const providerId = str((ctx.inputs.api_config as { provider_id?: unknown } | undefined)?.provider_id ?? ctx.inputs.api_config ?? '')
    if (!providerId) throw new Error('未连接「API服务商」节点')
    const provider = resolveProvider(providerId)
    if (!provider) throw new Error(`找不到 API 服务商配置: ${providerId}`)
    const baseUrl = (provider.base_url || provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const model = str(ctx.inputs.model) || provider.default_model || provider.model || 'gpt-4o-mini'
    const messages = Array.isArray(ctx.inputs.history) ? ctx.inputs.history : []
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key || provider.apiKey || ''}`
      },
      body: JSON.stringify({ model, messages, temperature: Number(ctx.inputs.temperature ?? 0.7) })
    })
    if (!res.ok) throw new Error(`LLM API 错误 ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const reply = String(data?.choices?.[0]?.message?.content ?? '')
    return { result: [reply], ui: { chat: [...messages, { role: 'assistant', content: reply }] } }
  }
}

/** 文本显示节点：透传输入文本，ui.text 供前端显示控件渲染 */
export const textDisplayImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const t = str(ctx.inputs.text)
    return { result: [t], ui: { text: [t] } }
  }
}

/** 数值显示节点：把 INT/FLOAT 显示出来（图像尺寸、数学运算结果等） */
export const numberDisplayImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const v = ctx.inputs.value
    const t = typeof v === 'number' ? String(Number(v.toFixed(6))) : str(v)
    return { result: [v], ui: { text: [t || '(空)'] } }
  }
}

/** 文本拼接：a + 分隔符 + b（多文本/数值混用都按字符串处理） */
export const textConcatImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const a = str(ctx.inputs.a)
    const b = str(ctx.inputs.b)
    const sep = str(ctx.inputs.separator)
    const t = a && b ? `${a}${sep}${b}` : a || b
    return { result: [t], ui: { text: [t] } }
  }
}

/** 文本替换：把 search 全部替换为 replace_with */
export const textReplaceImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const text = str(ctx.inputs.text)
    const search = str(ctx.inputs.search)
    if (!search) return { result: [text], ui: { text: [text] } }
    const t = text.split(search).join(str(ctx.inputs.replace_with))
    return { result: [t], ui: { text: [t] } }
  }
}

export const nativeTextDefs = [
  {
    name: 'TextInput',
    def: {
      input: { required: { text: ['STRING', { multiline: true, default: '' }] } },
      output: ['STRING'],
      output_name: ['TEXT'],
      name: 'TextInput',
      display_name: '文本输入',
      description: '输入一段文本，输出为 STRING。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: false
    }
  },
  {
    name: 'TextDisplay',
    def: {
      input: { required: { text: ['STRING', { forceInput: true }] } },
      output: [],
      output_name: [],
      name: 'TextDisplay',
      display_name: '文本显示',
      description: '显示输入文本（执行后更新）。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: true
    }
  },
  {
    name: 'NumberDisplay',
    def: {
      // 用 * 接收任意标量：INT（图像尺寸）和 FLOAT（数学运算）都能连进来
      input: { required: { value: ['*', { forceInput: true }] } },
      output: [],
      output_name: [],
      name: 'NumberDisplay',
      display_name: '数值显示',
      description: '显示输入的数字（可接「数学运算」「图像尺寸」的输出）。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: true
    }
  },
  {
    name: 'TextConcat',
    def: {
      input: {
        required: {
          a: ['STRING', { default: '' }],
          b: ['STRING', { default: '' }]
        },
        optional: { separator: ['STRING', { default: '\n' }] }
      },
      output: ['STRING'],
      output_name: ['TEXT'],
      name: 'TextConcat',
      display_name: '文本拼接',
      description: '把两段文本按分隔符拼成一段（分隔符默认换行）。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: false
    }
  },
  {
    name: 'TextReplace',
    def: {
      input: {
        required: {
          text: ['STRING', { default: '', multiline: true }],
          search: ['STRING', { default: '' }],
          replace_with: ['STRING', { default: '' }]
        }
      },
      output: ['STRING'],
      output_name: ['TEXT'],
      name: 'TextReplace',
      display_name: '文本替换',
      description: '把文本里的 search 全部替换成 replace_with。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: false
    }
  },
  {
    name: 'PromptRule',
    def: {
      input: { required: { rule: ['STRING', { multiline: true, default: '' }] } },
      output: ['STRING'],
      output_name: ['RULE'],
      name: 'PromptRule',
      display_name: '提示词规则',
      description: '填入提示词规则，配合「API服务商」与「文本处理」使用。',
      python_module: 'native.text',
      category: 'utils/text',
      output_node: false
    }
  },
  {
    name: 'ApiProvider',
    def: {
      input: { required: { provider: ['COMBO', { options: [] as string[] }] } },
      output: ['API_CONFIG'],
      output_name: ['API_CONFIG'],
      name: 'ApiProvider',
      display_name: 'API服务商',
      description: '选择已配置的 LLM API 服务商（配置来自设置）。',
      python_module: 'native.text',
      category: 'llm',
      output_node: false
    }
  },
  {
    name: 'TextProcess',
    def: {
      input: {
        required: {
          api_config: ['API_CONFIG', {}],
          rule: ['STRING', { forceInput: true }],
          text: ['STRING', { forceInput: true }]
        },
        optional: {
          model: ['STRING', { default: '' }],
          temperature: ['FLOAT', { default: 0.7, min: 0, max: 2, step: 0.1 }]
        }
      },
      output: ['STRING'],
      output_name: ['TEXT'],
      name: 'TextProcess',
      display_name: '文本处理',
      description: '用 API服务商 + 提示词规则 处理文本输入，输出处理结果。',
      python_module: 'native.text',
      category: 'llm',
      output_node: false
    }
  },
  {
    name: 'ChatNode',
    def: {
      input: {
        required: { api_config: ['API_CONFIG', {}] }
      },
      output: ['STRING'],
      output_name: ['REPLY'],
      name: 'ChatNode',
      display_name: '聊天',
      description: '与模型 API 对话：上方显示对话，下方输入并发送。',
      python_module: 'native.text',
      category: 'llm',
      output_node: true
    }
  }
]
