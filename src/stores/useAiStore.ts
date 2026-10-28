/**
 * AI 助手会话状态
 *
 * 一次「发送」的完整链路：
 *   前端 → POST /api/agent/chat（SSE 流式）
 *        ← delta（逐字渲染）
 *        ← tool_calls（模型要操作画布）
 *   前端执行工具（真的改画布）→ POST /api/agent/tool-result → 继续下一轮
 *   ……直到模型不再要工具，一轮结束。
 *
 * API 密钥只在服务端，前端只见 providerId/model。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { runTool } from '../ai/tools'

export interface AiAttachment {
  id: string
  kind: 'image' | 'text' | 'file'
  name: string
  size: number
  /** 图片：用于预览与视觉模型输入 */
  dataUrl?: string
  /** 文本类文件：内容直接拼进上下文 */
  text?: string
}

export interface AiStep {
  id: string
  name: string
  args: string
  status: 'running' | 'done' | 'error'
  result?: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments?: AiAttachment[]
  steps?: AiStep[]
  error?: string
  streaming?: boolean
  ts: number
}

export interface AiProvider {
  id: string
  name: string
  type: string
  base_url: string
  default_model: string
  temperature: number
  max_tokens: number
}

const LS_KEY = 'comfy.ai.v1'

interface Persisted {
  providerId?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  useTools?: boolean
  width?: number
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') as Persisted
  } catch {
    return {}
  }
}

export const useAiStore = defineStore('ai', () => {
  const saved = loadPersisted()

  const open = ref(false)
  const busy = ref(false)
  const sessionId = ref<string>(`s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
  const messages = ref<AiMessage[]>([])
  const providers = ref<AiProvider[]>([])
  const models = ref<string[]>([])
  const providerId = ref<string>(saved.providerId || '')
  const model = ref<string>(saved.model || '')
  const systemPrompt = ref<string>(saved.systemPrompt || '')
  const temperature = ref<number>(typeof saved.temperature === 'number' ? saved.temperature : 0.7)
  const useTools = ref<boolean>(saved.useTools !== false)
  const width = ref<number>(saved.width || 420)
  const lastError = ref('')
  /** 最近一次操作的目标（用于状态栏提示），如「运行工作流」 */
  const lastAction = ref('')

  const activeProvider = computed(() => providers.value.find((p) => p.id === providerId.value) || null)
  const hasProvider = computed(() => providers.value.length > 0)

  function persist(): void {
    const data: Persisted = {
      providerId: providerId.value,
      model: model.value,
      systemPrompt: systemPrompt.value,
      temperature: temperature.value,
      useTools: useTools.value,
      width: width.value
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    } catch {
      /* 忽略 */
    }
  }

  async function loadProviders(): Promise<void> {
    try {
      const res = await fetch('/api/agent/providers')
      providers.value = (await res.json()) as AiProvider[]
      if (!providerId.value || !providers.value.some((p) => p.id === providerId.value)) {
        providerId.value = providers.value[0]?.id || ''
        model.value = providers.value[0]?.default_model || ''
      }
      if (providerId.value && !model.value) {
        model.value = activeProvider.value?.default_model || ''
      }
      persist()
    } catch {
      providers.value = []
    }
  }

  async function loadModels(): Promise<void> {
    if (!providerId.value) return
    try {
      const res = await fetch(`/api/agent/models?provider_id=${encodeURIComponent(providerId.value)}`)
      const data = (await res.json()) as { ok?: boolean; models?: string[] }
      models.value = data.models || []
      if (!model.value) model.value = activeProvider.value?.default_model || ''
    } catch {
      models.value = []
    }
  }

  function setProvider(id: string): void {
    providerId.value = id
    const p = providers.value.find((x) => x.id === id)
    model.value = p?.default_model || ''
    models.value = []
    newSession()
    persist()
    void loadModels()
  }

  function newSession(): void {
    sessionId.value = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    messages.value = []
    lastError.value = ''
  }

  function toggle(openIt?: boolean): void {
    open.value = openIt === undefined ? !open.value : openIt
    if (open.value && !providers.value.length) void loadProviders()
  }

  /** 读一条 SSE 流，把事件回调出去 */
  async function readSse(res: Response, onEvent: (e: Record<string, any>) => void): Promise<void> {
    const reader = res.body?.getReader()
    if (!reader) {
      const txt = await res.text().catch(() => '')
      onEvent({ type: 'error', error: txt || '接口没有返回数据流' })
      return
    }
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        try {
          onEvent(JSON.parse(line.slice(5).trim()))
        } catch {
          /* 忽略无法解析的片段 */
        }
      }
    }
    if (buf.trim().startsWith('data:')) {
      try {
        onEvent(JSON.parse(buf.slice(5).trim()))
      } catch {
        /* 忽略 */
      }
    }
  }

  let abort: AbortController | null = null

  function stop(): void {
    abort?.abort()
    abort = null
    busy.value = false
    for (const m of messages.value) m.streaming = false
  }

  interface OutgoingPart {
    type: 'text' | 'image_url'
    text?: string
    image_url?: { url: string }
  }

  function buildUserContent(text: string, atts: AiAttachment[]): string | OutgoingPart[] {
    const parts: OutgoingPart[] = []
    for (const a of atts) {
      if (a.kind === 'image' && a.dataUrl) parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
      else if (a.text) parts.push({ type: 'text', text: `【附件 ${a.name}】\n${a.text}` })
    }
    const body = text.trim()
    if (body) parts.push({ type: 'text', text: body })
    return parts.length === 1 && parts[0].type === 'text' ? (parts[0].text as string) : parts
  }

  async function send(text: string, atts: AiAttachment[] = []): Promise<void> {
    if (busy.value) return
    if (!text.trim() && !atts.length) return
    if (!providerId.value) {
      await loadProviders()
      if (!providerId.value) {
        lastError.value = '还没有配置 API 供应商：打开「设置 → API 服务商」添加一个（OpenAI 兼容即可）'
        return
      }
    }
    lastError.value = ''
    busy.value = true
    abort = new AbortController()

    messages.value.push({
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text,
      attachments: atts.length ? atts : undefined,
      ts: Date.now()
    })

    const reply: AiMessage = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      text: '',
      steps: [],
      streaming: true,
      ts: Date.now()
    }
    messages.value.push(reply)

    // 关键：必须从响应式数组里取出代理对象再改。
    // 直接改上面的 reply（原始对象）不会触发 Vue 更新 —— 流式逐字渲染会完全看不到。
    const live = messages.value[messages.value.length - 1] as AiMessage

    try {
      let rounds = 0
      let toolResults: Array<{ tool_call_id: string; name: string; content: string }> | null = null
      for (;;) {
        if (abort?.signal.aborted) break
        rounds += 1
        if (rounds > 10) {
          live.text += '\n\n（已连续调用 10 轮工具，先停一下）'
          break
        }

        const body: Record<string, unknown> = {
          sessionId: sessionId.value,
          providerId: providerId.value,
          model: model.value || undefined,
          temperature: temperature.value,
          useTools: useTools.value
        }
        if (systemPrompt.value.trim()) body.systemPrompt = systemPrompt.value.trim()

        if (toolResults) {
          body.__toolResults = true
          body.results = toolResults
        } else {
          body.messages = [{ role: 'user' as const, content: buildUserContent(text, atts) }]
        }

        const res = await fetch(toolResults ? '/api/agent/tool-result' : '/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort?.signal
        })

        if (!res.ok) {
          live.error = `接口 HTTP ${res.status}`
          break
        }

        let pendingCalls: Array<{ id: string; function: { name: string; arguments: string } }> = []
        let failed = false

        await readSse(res, (e) => {
          if (e.type === 'delta') {
            live.text += String(e.text || '')
          } else if (e.type === 'tool_calls') {
            pendingCalls = (e.calls || []) as typeof pendingCalls
            if (e.text) live.text = String(e.text)
          } else if (e.type === 'error') {
            live.error = String(e.error || '请求失败')
            failed = true
          }
        })

        if (failed) break
        if (!pendingCalls.length) break

        // 执行工具
        toolResults = []
        for (const call of pendingCalls) {
          if (abort?.signal.aborted) break
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(call.function?.arguments || '{}')
          } catch {
            args = {}
          }
          const step: AiStep = {
            id: call.id || `tc_${Math.random().toString(36).slice(2, 8)}`,
            name: call.function?.name || '',
            args: JSON.stringify(args),
            status: 'running'
          }
          live.steps = [...(live.steps || []), step]
          lastAction.value = step.name
          const r = await runTool(step.name, args, step.id)
          const target = (live.steps || []).find((s) => s.id === step.id)
          if (target) {
            target.status = 'done'
            target.result = r.content
          }
          toolResults.push(r)
        }
        // 下一轮继续（把工具结果回传）
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') live.error = (e as Error).message
    } finally {
      live.streaming = false
      busy.value = false
      abort = null
    }
  }

  function removeMessage(id: string): void {
    messages.value = messages.value.filter((m) => m.id !== id)
  }

  function setWidth(w: number): void {
    width.value = Math.max(360, Math.min(720, Math.round(w)))
    persist()
  }

  function updateSettings(patch: Partial<Persisted>): void {
    if (patch.systemPrompt !== undefined) systemPrompt.value = patch.systemPrompt
    if (patch.temperature !== undefined) temperature.value = patch.temperature
    if (patch.useTools !== undefined) useTools.value = patch.useTools
    persist()
  }

  return {
    open,
    busy,
    messages,
    providers,
    models,
    providerId,
    model,
    systemPrompt,
    temperature,
    useTools,
    width,
    lastError,
    lastAction,
    activeProvider,
    hasProvider,
    loadProviders,
    loadModels,
    setProvider,
    newSession,
    toggle,
    send,
    stop,
    removeMessage,
    setWidth,
    updateSettings
  }
})
