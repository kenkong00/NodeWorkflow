/**
 * ComfyStore —— 全局状态：节点注册表 / WebSocket 执行事件 / 队列 / 工作流 / 标签页 / 插件
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { FrontNodeDef } from '../engine/nodeFactory'

export interface PluginInfo {
  name: string
  enabled: boolean
  dir: string
  nodes: string[]
  webDir?: string
  error?: string
  hasExecutor?: boolean
}

export interface WorkflowMeta {
  id: string
  name: string
  created_at: number
  updated_at: number
  /** 所在子文件夹（相对路径，根目录为 ''） */
  folder?: string
  nodeCount?: number
}

/** 工作流目录树里的文件夹节点 */
export interface WorkflowTreeNode {
  type: 'folder'
  name: string
  path: string
  folders: WorkflowTreeNode[]
  files: Array<{ id: string; name: string; path: string; updated_at: number; nodeCount: number }>
}

/** 队列里的一个任务（用于运行/停止按钮的下拉） */
export interface QueueTask {
  prompt_id: string
  number: number
  title?: string
}

interface ExecState {
  status: 'idle' | 'running' | 'error' | 'interrupted'
  currentNode: string | null
  currentNodeTitle: string
  progress: number
  lastError: string
  promptId: string | null
  running: QueueTask | null
  pending: QueueTask[]
  /** 最近一次完成提示（页脚短暂展示） */
  lastDone: string
}

export const useComfyStore = defineStore('comfy', () => {
  // ---------- 节点注册表 ----------
  const nodeDefs = ref<Record<string, FrontNodeDef>>({})
  const registryLoaded = ref(false)

  /**
   * 「只显示本机可运行的节点」开关（左侧节点库 + 画布右键的搜索框共用同一份状态）。
   * 默认开启：注册表里非 native 的节点（本机 ComfyUI 没装对应插件）拖进画布也跑不起来，
   * 与其让人放上去再报错，不如默认不出现在任何选择入口里。持久化到 localStorage。
   */
  const ONLY_NATIVE_KEY = 'comfy.onlyNative'
  const onlyNative = ref<boolean>(localStorage.getItem(ONLY_NATIVE_KEY) !== '0')
  watch(onlyNative, (v) => {
    localStorage.setItem(ONLY_NATIVE_KEY, v ? '1' : '0')
  })

  /**
   * 注册表按开关过滤后的节点列表（可运行性唯一判据：def.native）。
   * def.hidden（与 native 版重复的官方同名节点）在任何入口都不列出。
   */
  const visibleNodeDefs = computed<FrontNodeDef[]>(() =>
    Object.values(nodeDefs.value).filter((d) => !d.hidden && (!onlyNative.value || !!d.native))
  )

  const categoryTree = computed(() => {
    const map = new Map<string, Array<{ name: string; display_name: string; native: boolean }>>()
    for (const def of Object.values(nodeDefs.value)) {
      if (def.hidden) continue
      const cat = def.category || 'sd'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push({ name: def.name, display_name: def.display_name || def.name, native: !!def.native })
    }
    return [...map.entries()]
      .map(([category, nodes]) => ({ category, nodes: nodes.sort((a, b) => a.display_name.localeCompare(b.display_name)) }))
      .sort((a, b) => a.category.localeCompare(b.category))
  })

  /** 只有「本系统能直接跑」的节点分类，用于节点库「本地可运行」筛选 */
  const nativeCategories = computed(() => {
    const set = new Set<string>()
    for (const def of Object.values(nodeDefs.value)) {
      if (def.native) set.add(def.category || 'sd')
    }
    return set
  })

  async function loadRegistry(): Promise<void> {
    const res = await fetch('/object_info')
    nodeDefs.value = (await res.json()) as Record<string, FrontNodeDef>
    registryLoaded.value = true
  }

  // ---------- WebSocket ----------
  let ws: WebSocket | null = null
  const exec = ref<ExecState>({
    status: 'idle',
    currentNode: null,
    currentNodeTitle: '',
    progress: 0,
    lastError: '',
    promptId: null,
    running: null,
    pending: [],
    lastDone: ''
  })

  let outputHandler: ((nodeId: string, nodeType: string, output: unknown) => void) | null = null
  let executingHandler: ((nodeId: string | null, active: boolean) => void) | null = null

  function onNodeOutput(fn: (nodeId: string, nodeType: string, output: unknown) => void): void {
    outputHandler = fn
  }
  function onNodeExecuting(fn: (nodeId: string | null, active: boolean) => void): void {
    executingHandler = fn
  }

  function connectWS(): void {
    if (ws && ws.readyState <= 1) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${protocol}://${location.host}/ws`)
    ws.onopen = () => {
      // 重新连上后同步一次队列（页面刷新/断线重连不丢状态）
      void refreshQueue()
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; data: Record<string, unknown> }
        handleEvent(msg.type, msg.data)
      } catch { /* 忽略解析错误 */ }
    }
    ws.onclose = () => {
      setTimeout(() => connectWS(), 2000)
    }
  }

  async function refreshQueue(): Promise<void> {
    try {
      const res = await fetch('/queue')
      const data = (await res.json()) as { running?: QueueTask[]; pending?: QueueTask[] }
      exec.value.running = data.running?.[0] ?? null
      exec.value.pending = data.pending || []
      if (exec.value.running) exec.value.status = 'running'
    } catch { /* 忽略 */ }
  }

  function handleEvent(type: string, data: Record<string, unknown>): void {
    switch (type) {
      case 'status': {
        const d = data as { status?: string; exec_info?: { queue_remaining?: number }; running?: QueueTask[]; pending?: QueueTask[] }
        // 单任务完成时后端会发不带 running/pending 的 status；此时保留现有列表
        if (Array.isArray(d.running)) exec.value.running = d.running[0] ?? null
        if (Array.isArray(d.pending)) exec.value.pending = d.pending
        if (d.status === 'running') exec.value.status = 'running'
        else if (d.status === 'idle' && !exec.value.running && !exec.value.pending.length) exec.value.status = 'idle'
        break
      }
      case 'execution_start':
        exec.value.status = 'running'
        exec.value.promptId = data.prompt_id as string
        exec.value.lastError = ''
        break
      case 'executing': {
        const node = data.node as string | null
        if (node === null) {
          executingHandler?.(null, false)
          exec.value.currentNode = null
          exec.value.currentNodeTitle = ''
        } else {
          executingHandler?.(node, true)
          exec.value.currentNode = node
          exec.value.currentNodeTitle = nodeDefs.value[data.class_type as string]?.display_name || (data.node as string)
        }
        break
      }
      case 'progress':
        exec.value.progress = (data.value as number) / (data.max as number)
        break
      case 'executed': {
        const node = data.node as string
        executingHandler?.(node, false)
        outputHandler?.(node, '', data.output)
        break
      }
      case 'execution_error':
        exec.value.status = 'error'
        exec.value.lastError = (data.exception_message as string) || '执行出错'
        break
      case 'execution_interrupted':
        exec.value.status = 'interrupted'
        break
      case 'task_done':
        exec.value.lastDone = new Date().toLocaleTimeString()
        break
    }
  }

  // ---------- 执行 ----------
  async function queuePrompt(
    prompt: Record<string, unknown>,
    title?: string
  ): Promise<{ ok: boolean; error?: string; promptId?: string }> {
    try {
      const res = await fetch('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, extra_data: { title: title || workflowName.value } })
      })
      const data = (await res.json()) as {
        prompt_id?: string
        error?: string | { type?: string; message?: string; details?: string }
        details?: string
        node_errors?: Record<string, { class_type: string; errors: Array<{ message: string; details: string }> }>
      }
      if (!res.ok) {
        let msg = ''
        if (typeof data.error === 'string') msg = data.error
        else if (data.error && typeof data.error === 'object') {
          msg = data.error.message || '工作流校验失败'
          if (data.error.details) msg += `：${data.error.details}`
        }
        if (data.node_errors) {
          const per = Object.entries(data.node_errors).map(
            ([nid, ne]) => `#${nid} ${ne.class_type}: ${ne.errors.map((x) => `${x.message}(${x.details})`).join('; ')}`
          )
          if (per.length) msg += `\n${per.join('\n')}`
        }
        return { ok: false, error: msg || data.details || `提交失败 HTTP ${res.status}` }
      }
      return { ok: true, promptId: data.prompt_id }
    } catch (e) {
      return { ok: false, error: `提交失败：${(e as Error).message}` }
    }
  }

  /** 取消单个任务（排队中直接移除；正在跑则中断） */
  async function cancelTask(promptId: string): Promise<boolean> {
    try {
      const res = await fetch('/queue/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId })
      })
      const data = (await res.json()) as { ok?: boolean }
      if (data.ok) {
        exec.value.pending = exec.value.pending.filter((t) => t.prompt_id !== promptId)
        if (exec.value.running?.prompt_id === promptId) exec.value.running = null
      }
      return !!data.ok
    } catch {
      return false
    }
  }

  /** 中断全部 */
  async function interrupt(): Promise<void> {
    try {
      await fetch('/interrupt', { method: 'POST' })
    } catch { /* 忽略 */ }
    exec.value.running = null
    exec.value.pending = []
  }

  // ---------- 工作流持久化 ----------
  const workflows = ref<WorkflowMeta[]>([])
  /** 当前标签页绑定的服务端工作流 id */
  const currentWorkflowId = ref<string | null>(null)
  const workflowName = ref('未命名工作流')

  async function loadWorkflowList(): Promise<void> {
    const res = await fetch('/api/workflow-files')
    workflows.value = (await res.json()) as WorkflowMeta[]
  }

  /** 工作流目录的文件夹树（侧边「打开工作流」面板用） */
  async function loadWorkflowTree(): Promise<WorkflowTreeNode> {
    const res = await fetch('/api/workflow-tree')
    const ct = res.headers.get('content-type') || ''
    // 旧版服务（或连错端口）没有这个接口，会把 index.html 当 200 返回，
    // 直接 res.json() 只会抛一个看不懂的解析错误，这里先挡掉并说人话。
    if (!res.ok || !ct.includes('application/json')) {
      throw new Error(`HTTP ${res.status}：服务端没有 /api/workflow-tree，可能连到了旧的服务实例（请确认端口并重启 dev server）`)
    }
    return (await res.json()) as WorkflowTreeNode
  }

  async function createWorkflowFolder(parent: string, name: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    const res = await fetch('/api/workflow-dirs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name })
    })
    const data = (await res.json()) as { ok?: boolean; error?: string; id?: string }
    if (!res.ok || data.error) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, id: data.id }
  }

  async function renameWorkflowFolder(path: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/workflow-dirs/${encodeURI(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName })
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || data.error) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true }
  }

  async function deleteWorkflowFolder(path: string): Promise<void> {
    await fetch(`/api/workflow-dirs/${encodeURI(path)}`, { method: 'DELETE' }).catch(() => {})
  }

  /** 把工作流图保存为磁盘 JSON 文件（ComfyUI 同款：文件名即身份） */
  async function writeWorkflowFile(name: string, graph: unknown, folder = ''): Promise<string> {
    const safe = (name || '未命名工作流').replace(/\.json$/i, '').trim() || '未命名工作流'
    const res = await fetch('/api/workflow-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safe, graph, folder })
    })
    const data = (await res.json()) as { id: string }
    currentWorkflowId.value = data.id
    await loadWorkflowList()
    return data.id
  }

  async function saveWorkflow(graph: unknown, name?: string): Promise<string> {
    // 已保存过 → 覆盖同名文件（文件名 = currentWorkflowId）
    return writeWorkflowFile(currentWorkflowId.value || name || workflowName.value, graph, currentFolderOf(currentWorkflowId.value))
  }

  /** currentWorkflowId 形如 "文件夹/名字"，取它的文件夹部分 */
  function currentFolderOf(id: string | null): string {
    if (!id) return ''
    const i = id.lastIndexOf('/')
    return i > 0 ? id.slice(0, i) : ''
  }

  /** 另存为新工作流（标签页"另存为"或复制标签时用） */
  async function saveWorkflowAs(graph: unknown, name: string, folder = ''): Promise<string> {
    return writeWorkflowFile(name, graph, folder)
  }

  /** 覆盖指定工作流（另存为时命中同名 → 覆盖保存；名字变了则删旧建新） */
  async function saveWorkflowTo(id: string, graph: unknown, name: string): Promise<string> {
    if (id && id !== name) {
      await fetch(`/api/workflow-files/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
    return writeWorkflowFile(name, graph)
  }

  /** 只改名称（标签页双击重命名 → 移动磁盘文件，文件名即身份） */
  async function renameWorkflow(id: string, name: string): Promise<void> {
    if (!id) return
    const safe = name.replace(/\.json$/i, '').trim()
    if (!safe) return
    await fetch(`/api/workflow-files/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: safe })
    })
    await loadWorkflowList()
  }

  async function openWorkflow(id: string): Promise<unknown> {
    const res = await fetch(`/api/workflow-files/${encodeURIComponent(id)}`)
    const row = (await res.json()) as { graph: unknown; name: string }
    currentWorkflowId.value = id
    workflowName.value = row.name ?? id
    return row.graph
  }

  async function openWorkflowFromFile(file: File): Promise<{ ok: boolean; error?: string; name?: string; nodeCount?: number }> {
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      return { ok: false, error: '文件不是合法的 JSON' }
    }
    const wf = json as { nodes?: unknown[] }
    if (!Array.isArray(wf.nodes)) {
      return { ok: false, error: '不是工作流文件（缺少 nodes 字段）' }
    }
    currentWorkflowId.value = null
    workflowName.value = file.name.replace(/\.json$/i, '')
    return { ok: true, name: file.name, nodeCount: wf.nodes.length }
  }

  async function deleteWorkflow(id: string): Promise<void> {
    await fetch(`/api/workflow-files/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    if (currentWorkflowId.value === id) currentWorkflowId.value = null
    await loadWorkflowList()
  }

  // ---------- 未保存草稿自动恢复（刷新不丢状态，ComfyUI 同款） ----------
  const DRAFT_KEY = 'comfy.draft'

  /** 把当前画布图写入 localStorage（仅在有节点时存储；空图不存，保证首启是干净的空画布） */
  function persistDraft(graph: unknown, dirty: boolean): void {
    try {
      const g = graph as { nodes?: unknown[] } | null
      if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) {
        // 空画布：清掉旧草稿，避免刷新后把"已清空"误恢复成旧内容
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ graph: g, name: workflowName.value, file: currentWorkflowId.value, dirty, ts: Date.now() })
      )
    } catch {
      /* localStorage 容量上限（大图可能超出）→ 静默跳过，不影响使用 */
    }
  }

  /** 启动时读取草稿；无 / 空 / 损坏则返回 null */
  function loadDraft(): { graph: unknown; name: string; file: string | null; dirty: boolean } | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return null
      const d = JSON.parse(raw)
      if (!d || !d.graph || !Array.isArray(d.graph.nodes) || d.graph.nodes.length === 0) return null
      return { graph: d.graph, name: d.name || '未命名工作流', file: d.file ?? null, dirty: !!d.dirty }
    } catch {
      return null
    }
  }

  function clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }

  // ---------- 插件 ----------
  const plugins = ref<PluginInfo[]>([])

  async function loadPlugins(): Promise<void> {
    const res = await fetch('/api/plugins')
    plugins.value = (await res.json()) as PluginInfo[]
  }

  async function installPlugin(url: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
    const data = (await res.json()) as { ok: boolean; message: string }
    await loadPlugins()
    return data
  }

  async function togglePlugin(name: string, enable: boolean): Promise<void> {
    await fetch(`/api/plugins/${enable ? 'enable' : 'disable'}/${name}`, { method: 'POST' })
    await loadPlugins()
  }

  async function uninstallPlugin(name: string): Promise<void> {
    await fetch(`/api/plugins/${name}`, { method: 'DELETE' })
    await loadPlugins()
  }

  async function reloadPlugins(): Promise<void> {
    await fetch('/api/plugins/reload', { method: 'POST' })
    await loadPlugins()
  }

  // ---------- LLM 提供商 ----------
  const llmProviders = ref<Array<{
    id: string
    name: string
    provider_type: string
    default_model?: string
    base_url?: string
    api_key?: string
    enabled: boolean | number
  }>>([])
  async function loadLLMProviders(): Promise<void> {
    const res = await fetch('/api/llm-providers')
    llmProviders.value = (await res.json()) as typeof llmProviders.value
  }

  return {
    nodeDefs,
    registryLoaded,
    onlyNative,
    visibleNodeDefs,
    categoryTree,
    nativeCategories,
    loadRegistry,
    exec,
    connectWS,
    refreshQueue,
    onNodeOutput,
    onNodeExecuting,
    queuePrompt,
    cancelTask,
    interrupt,
    workflows,
    currentWorkflowId,
    workflowName,
    loadWorkflowList,
    loadWorkflowTree,
    createWorkflowFolder,
    renameWorkflowFolder,
    deleteWorkflowFolder,
    saveWorkflow,
    saveWorkflowAs,
    saveWorkflowTo,
    renameWorkflow,
    openWorkflow,
    openWorkflowFromFile,
    deleteWorkflow,
    persistDraft,
    loadDraft,
    clearDraft,
    plugins,
    loadPlugins,
    installPlugin,
    togglePlugin,
    uninstallPlugin,
    reloadPlugins,
    llmProviders,
    loadLLMProviders
  }
})
