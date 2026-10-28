/**
 * AI 助手的会话与调用编排
 *
 * 设计要点：
 *  - 供应商复用「设置 → API 服务商」里已配好的 OpenAI 兼容端点（base_url + key + model），
 *    密钥只留在服务端，前端永远拿不到。
 *  - 对话走 SSE 流式：{type:'delta'|'tool_calls'|'done'|'error'}，前端边收边渲染。
 *  - 工具调用（function calling）由**前端执行**：模型想操作画布时，服务端把 tool_calls
 *    推给前端，前端真的去改画布，再把结果 POST 回 /api/agent/tool-result 继续下一轮。
 *    这样不需要把 litegraph 的状态同步到服务端，也不会出现"模型以为改了其实没改"。
 */
import type { ServerResponse } from 'http'
import { randomUUID } from 'node:crypto'
import { llmRepoRef } from './repoRef'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** 画布/工作流操作工具：前端 AiTools 里有同名执行器 */
export const AGENT_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_node_types',
      description: '列出当前可用的节点类型（可选按关键字过滤）。返回 [{name, display_name, category, description, inputs, outputs}]。构建工作流前先调用它确认节点名。',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: '关键字，按节点名/显示名/分类过滤，可为空' },
          limit: { type: 'number', description: '最多返回多少条，默认 60' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_canvas',
      description: '读取当前画布：节点（id/类型/标题/位置/控件值）与连线。想知道现在画布上有什么就调用它。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_node',
      description: '在画布上添加一个节点，返回新节点 id 与它的输入/输出端口。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '节点类型名（用 list_node_types 查到的 name）' },
          x: { type: 'number', description: '画布 x 坐标，不给则自动排布' },
          y: { type: 'number', description: '画布 y 坐标，不给则自动排布' }
        },
        required: ['type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'connect_nodes',
      description: '把 A 节点的输出连到 B 节点的输入。连线前确认两端端口类型兼容。',
      parameters: {
        type: 'object',
        properties: {
          from_id: { type: 'number', description: '源节点 id' },
          from_slot: { type: 'number', description: '源输出端口序号，从 0 开始' },
          to_id: { type: 'number', description: '目标节点 id' },
          to_slot: { type: 'number', description: '目标输入端口序号，从 0 开始' }
        },
        required: ['from_id', 'from_slot', 'to_id', 'to_slot']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_widget_value',
      description: '设置节点上某个控件（参数）的值，例如文本、整数、下拉选项、图片文件名。',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'number' },
          name: { type: 'string', description: '控件名，如 text / value / image' },
          value: { description: '新值（字符串/数字/布尔均可）' }
        },
        required: ['node_id', 'name', 'value']
      }
    }
  },
  {
    type: 'function',
    function: { name: 'remove_node', description: '删除画布上的一个节点。', parameters: { type: 'object', properties: { node_id: { type: 'number' } }, required: ['node_id'] } }
  },
  {
    type: 'function',
    function: { name: 'clear_canvas', description: '清空当前画布（会提示用户确认）。', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function',
    function: { name: 'fit_view', description: '把画布缩放到适应窗口，让用户能看到全部节点。', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function',
    function: {
      name: 'list_workflows',
      description: '列出 user/workflows 目录里已保存的工作流（含子文件夹）。',
      parameters: { type: 'object', properties: { folder: { type: 'string', description: '子文件夹相对路径，可为空表示全部' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_workflow',
      description: '打开一个已保存的工作流到画布。id 是相对路径（如 test/我的工作流）。',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: { name: 'run_workflow', description: '运行当前画布上的工作流。', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function',
    function: {
      name: 'save_workflow',
      description: '把当前画布保存成工作流文件。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, folder: { type: 'string', description: '保存到哪个子文件夹，可为空' } },
        required: ['name']
      }
    }
  }
]

const DEFAULT_SYSTEM = `你是一个嵌入在「节点编辑工作流」编辑器里的 AI 助手，可以直接操作用户的画布。

能力：
- 用 list_node_types 查可用节点，用 get_canvas 看当前画布；
- 用 add_node / connect_nodes / set_widget_value / remove_node 组合出工作流；
- 用 list_workflows / open_workflow 调用用户已保存的工作流；
- 用 run_workflow 执行当前画布，用 save_workflow 保存。

行为准则：
1. 动手前先用 get_canvas 或 list_node_types 确认事实，不要凭空猜节点名和端口序号。
2. 每一步都用简短中文说明在做什么，再调用工具；工具结果出来后自己检查是否达到目的。
3. 连线必须类型匹配（IMAGE→IMAGE、STRING→STRING、INT/FLOAT→INT/FLOAT…），不确定就先 list_node_types 看端口。
4. 需要用户确认的破坏性操作（clear_canvas、覆盖保存）先问一句。
5. 回答用中文，排版用 Markdown；代码块要标语言。`

interface Session {
  id: string
  messages: ChatMsg[]
  providerId: string
  model: string
  system: string
  updatedAt: number
}

const sessions = new Map<string, Session>()
const MAX_SESSIONS = 40

function touch(sessionId: string): void {
  // 简单的 LRU 清理，避免长期运行后无限增长
  if (sessions.size <= MAX_SESSIONS) return
  const oldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0]
  if (oldest) sessions.delete(oldest.id)
  void sessionId
}

function sseWrite(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function pickProvider(providerId?: string): { id: string; name: string; base_url: string; api_key: string; default_model: string; temperature: number; max_tokens: number } | null {
  const all = llmRepoRef().findAll().filter((p) => p.enabled)
  if (!all.length) return null
  if (providerId) {
    const hit = all.find((p) => p.id === providerId)
    if (hit) return hit
  }
  return all[0]
}

export function agentSessions(): number {
  return sessions.size
}

export function dropSession(id: string): void {
  sessions.delete(id)
}

/**
 * 跑一轮：要么是新用户消息，要么是工具结果回传（body.__toolResults = true）。
 * 流式结果直接写进 res（SSE）。
 */
export async function runAgentTurn(body: Record<string, any>, res: ServerResponse): Promise<void> {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  try {
    const provider = pickProvider(body.providerId ? String(body.providerId) : '')
    if (!provider) {
      sseWrite(res, { type: 'error', error: '还没有可用的 API 供应商：请到「设置 → API 服务商」添加一个（OpenAI 兼容即可）。' })
      res.end()
      return
    }

    const sid = String(body.sessionId || randomUUID())
    let session = sessions.get(sid)
    const incoming = Array.isArray(body.messages) ? (body.messages as ChatMsg[]) : []

    if (!session) {
      session = {
        id: sid,
        messages: [{ role: 'system', content: String(body.systemPrompt || DEFAULT_SYSTEM) }],
        providerId: provider.id,
        model: String(body.model || provider.default_model || ''),
        system: String(body.systemPrompt || DEFAULT_SYSTEM),
        updatedAt: Date.now()
      }
      sessions.set(sid, session)
      touch(sid)
    }
    if (body.model) session.model = String(body.model)
    if (body.systemPrompt && body.systemPrompt !== session.system) {
      session.system = String(body.systemPrompt)
      session.messages[0] = { role: 'system', content: session.system }
    }

    if (body.__toolResults) {
      // 前端执行完工具后回传：[{tool_call_id, name, content}]
      const results = Array.isArray(body.results) ? body.results : []
      for (const r of results) {
        session.messages.push({
          role: 'tool',
          tool_call_id: String(r.tool_call_id || ''),
          name: String(r.name || ''),
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
        })
      }
    } else {
      for (const m of incoming) session.messages.push(m)
    }
    session.updatedAt = Date.now()

    const model = session.model || provider.default_model
    if (!model) {
      sseWrite(res, { type: 'error', error: '该供应商没有配置默认模型，请到设置里填一个。' })
      res.end()
      return
    }

    // 保留最近 40 条，避免上下文无限膨胀
    if (session.messages.length > 40) {
      session.messages = [session.messages[0], ...session.messages.slice(-39)]
    }

    const payload: Record<string, unknown> = {
      model,
      messages: session.messages,
      stream: true,
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : Number(provider.temperature ?? 0.7),
      max_tokens: Number(body.maxTokens ?? provider.max_tokens ?? 4096)
    }
    if (body.useTools !== false) payload.tools = AGENT_TOOLS

    const base = String(provider.base_url || '').replace(/\/+$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.api_key) headers.Authorization = `Bearer ${provider.api_key}`

    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => '')
      sseWrite(res, {
        type: 'error',
        error: `「${provider.name}」接口返回 HTTP ${upstream.status}：${txt.slice(0, 300)}`,
        provider: provider.name,
        base_url: base
      })
      res.end()
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    const toolCalls: NonNullable<ChatMsg['tool_calls']> = []

    const flushLines = (lines: string[]) => {
      for (const raw of lines) {
        const line = raw.trim()
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let json: any
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const choice = json?.choices?.[0]
        const delta = choice?.delta || {}
        if (typeof delta.content === 'string' && delta.content) {
          full += delta.content
          sseWrite(res, { type: 'delta', text: delta.content })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx: number = tc.index ?? 0
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } }
            }
            if (tc.id) toolCalls[idx].id = tc.id
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      flushLines(lines)
    }
    if (buf.trim()) flushLines([buf])

    const calls = toolCalls.filter((c) => c && c.function?.name)
    session.messages.push(
      calls.length
        ? { role: 'assistant', content: full || '', tool_calls: calls }
        : { role: 'assistant', content: full }
    )
    session.updatedAt = Date.now()

    if (calls.length) {
      sseWrite(res, { type: 'tool_calls', calls, text: full })
    }
    sseWrite(res, { type: 'done', sessionId: sid, awaitingTools: calls.length > 0, model, provider: provider.name })
    res.end()
  } catch (e) {
    // 连不上（DNS/代理/超时）时，把供应商名和地址一起回传，避免只看到一句 "fetch failed"
    const msg = (e as Error).message || String(e)
    const p = llmRepoRef().findAll().find((x) => x.id === String(body.providerId || ''))
    const hint = p ? `「${p.name}」(${String(p.base_url || '').replace(/\/+$/, '')}) 连接失败：${msg}。请检查网络/代理，或在 AI 窗口右上角换一个供应商。` : msg
    sseWrite(res, { type: 'error', error: hint })
    res.end()
  }
}

export function listAgentTools(): ToolDef[] {
  return AGENT_TOOLS
}
