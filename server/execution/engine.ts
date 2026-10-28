/**
 * 执行引擎 —— 复刻 ComfyUI PromptExecutor 行为
 *  1. validate（execution/validate.ts）
 *  2. 构建 ExecutionList（从输出节点向上收集依赖）
 *  3. 分批执行：就绪节点逐个执行，输出缓存，进度/事件广播
 *  4. 环检测（DependencyCycleError）
 *  5. 无原生实现的节点 → 委托 comfy-executor 插件整体转发到真实 ComfyUI
 */
import { ExecutionList, DependencyCycleError } from './executionList'
import { PromptValidator, type Prompt } from './validate'
import type { NodeRegistry } from '../registry'

export interface ExecEvents {
  onStatus?: (data: unknown) => void
  onExecutionStart?: (data: { prompt_id: string }) => void
  onExecuting?: (data: { node: string | null; prompt_id: string }) => void
  onProgress?: (data: { node: string; value: number; max: number; prompt_id: string }) => void
  onExecuted?: (data: { node: string; output: unknown; prompt_id: string }) => void
  onExecutionError?: (data: { prompt_id: string; node_id?: string; exception_message: string }) => void
  onExecutionCached?: (data: { nodes: string[]; prompt_id: string }) => void
}

export interface ExecutorPlugin {
  id: string
  name: string
  /** 是否能执行该 prompt（存在无原生实现的节点时可接管） */
  canExecute: (prompt: Prompt, registry: NodeRegistry) => boolean
  /** 委托执行：负责把 prompt 送到真实 ComfyUI 并回传事件/输出 */
  execute: (prompt: Prompt, events: ExecEvents, opts: { promptId: string; cancelled: () => boolean }) => Promise<Map<string, unknown>>
}

const executors: ExecutorPlugin[] = []

/** 注册委托执行器（插件用） */
export function registerExecutor(plugin: ExecutorPlugin): void {
  executors.push(plugin)
}

export function findExecutor(prompt: Prompt, registry: NodeRegistry): ExecutorPlugin | undefined {
  return executors.find((e) => e.canExecute(prompt, registry))
}

export class PromptExecutor {
  registry: NodeRegistry
  constructor(registry: NodeRegistry) {
    this.registry = registry
  }

  /** 收集某节点及其全部上游（用于构建执行列表） */
  private collectDependencies(prompt: Prompt, outputs: string[]): Map<string, string[]> {
    const deps = new Map<string, string[]>()
    const visit = (id: string) => {
      if (deps.has(id)) return
      deps.set(id, []) // 先占位：环上节点递归回来时直接返回，交由 ensureNoDeadlock 报 DependencyCycleError
      const node = prompt[id]
      if (!node) return
      const list: string[] = []
      for (const v of Object.values(node.inputs || {})) {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') {
          const oid = v[0] as string
          if (prompt[oid]) {
            list.push(oid)
            visit(oid)
          }
        }
      }
      deps.set(id, list)
    }
    for (const o of outputs) visit(o)
    return deps
  }

  async execute(prompt: Prompt, promptId: string, events: ExecEvents, cancelled: () => boolean): Promise<void> {
    const validator = new PromptValidator(this.registry)
    const result = validator.validate(prompt)
    if (!result.valid) {
      const firstErr = result.error!
      const nodeId = Object.keys(result.node_errors)[0]
      events.onExecutionError?.({
        prompt_id: promptId,
        node_id: nodeId,
        exception_message: `${firstErr.message}${firstErr.details ? `: ${firstErr.details}` : ''}`
      })
      return
    }

    // 无原生实现的节点 → 委托执行器
    const missing = Object.entries(prompt).filter(([, n]) => !this.registry.hasNativeImpl(n.class_type))
    if (missing.length > 0) {
      const executor = findExecutor(prompt, this.registry)
      if (executor) {
        events.onStatus?.({ exec_info: { prompt_id: promptId, executor: executor.id } })
        await executor.execute(prompt, events, { promptId, cancelled })
        return
      }
      const [id, node] = missing[0]
      events.onExecutionError?.({
        prompt_id: promptId,
        node_id: id,
        exception_message: `节点 ${node.class_type} 没有可用执行实现（原生或插件执行器）。请在「插件管理」安装 comfy-executor 并配置 ComfyUI 地址，或安装提供该节点实现的插件。`
      })
      return
    }

    events.onExecutionStart?.({ prompt_id: promptId })

    const deps = this.collectDependencies(prompt, result.good_outputs)
    const list = new ExecutionList()
    for (const [id, ds] of deps) list.addNode(id, ds)
    const isOutput = (id: string) => this.registry.getDef(prompt[id].class_type)?.output_node === true

    const outputsCache = new Map<string, unknown[]>()
    const uiCache = new Map<string, unknown>()

    try {
      list.ensureNoDeadlock(isOutput)
    } catch (e) {
      if (e instanceof DependencyCycleError) {
        events.onExecutionError?.({
          prompt_id: promptId,
          node_id: e.cycleNodes[0],
          exception_message: `检测到依赖环（Dependency cycle detected）：${e.cycleNodes.join(', ')}`
        })
        return
      }
      throw e
    }

    events.onExecuting?.({ node: null, prompt_id: promptId })

    while (!list.isEmpty()) {
      if (cancelled()) {
        events.onStatus?.({ status: 'interrupted' })
        return
      }
      const ready = list.getReadyNodes(isOutput)
      if (ready.length === 0) break
      const id = ready[0]
      const node = prompt[id]
      const def = this.registry.getDef(node.class_type)!
      const impl = this.registry.getImpl(node.class_type)!

      // 解析输入：连线取上游输出，字面量直接使用
      const inputs: Record<string, unknown> = {}
      for (const [name, v] of Object.entries(node.inputs || {})) {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') {
          const [oid, slot] = v as [string, number]
          const upstream = outputsCache.get(oid)
          inputs[name] = upstream ? upstream[slot] : undefined
        } else {
          inputs[name] = v
        }
      }
      // 前端附加的动态输入（如聊天历史）
      const extra = (node as unknown as { _extra?: Record<string, unknown> })._extra
      if (extra) Object.assign(inputs, extra)

      events.onExecuting?.({ node: id, prompt_id: promptId })
      try {
        const res = await impl.execute({
          inputs,
          nodeId: id,
          isCancelled: cancelled,
          onProgress: (ratio) => events.onProgress?.({ node: id, value: ratio, max: 1, prompt_id: promptId })
        })
        outputsCache.set(id, res.result || [])
        if (res.ui) uiCache.set(id, res.ui)
        events.onExecuted?.({ node: id, output: res.ui ?? res.result, prompt_id: promptId })
      } catch (e) {
        events.onExecutionError?.({
          prompt_id: promptId,
          node_id: id,
          exception_message: `${def.display_name || node.class_type} 执行失败: ${(e as Error).message}`
        })
        return
      }
      list.completeNode(id)
    }

    events.onStatus?.({ status: 'success', completed: true })
  }
}
