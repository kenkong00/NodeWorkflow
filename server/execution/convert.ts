/**
 * 工作流 JSON → ComfyUI prompt 格式转换
 * 输入：ComfyUI 工作流格式（nodes/links/widgets_values/last_node_id/last_link_id）
 * 输出：{ [nodeId]: { class_type, inputs } }，inputs 中连线为 [nodeId, slotIndex]
 */
import type { NodeDef } from '../registry/types'

export interface WorkflowNode {
  id: number
  type: string
  pos: [number, number]
  size?: [number, number]
  flags?: Record<string, unknown>
  order?: number
  mode?: number
  inputs?: Array<{ name: string; type: string; link: number | null }>
  outputs?: Array<{ name: string; type: string; links: number[] | null; slot_index?: number }>
  properties?: Record<string, unknown>
  widgets_values?: unknown[]
}

export interface WorkflowLink {
  id: number
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
  type: string
  parentId?: number
}

export interface WorkflowJSON {
  last_node_id: number
  last_link_id: number
  nodes: WorkflowNode[]
  /** ComfyUI 工作流格式：元组数组 [id, origin_id, origin_slot, target_id, target_slot, type]（兼容对象形式） */
  links: Array<[number, number, number, number, number, string] | WorkflowLink>
  [k: string]: unknown
}

export interface PromptNodeOut {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

export type PromptOut = Record<string, PromptNodeOut>

/** 回溯经过 Reroute 的连线，找到真实上游输出 */
function resolveLinkOrigin(
  linkId: number,
  links: Map<number, WorkflowLink>,
  nodeById: Map<number, WorkflowNode>,
  depth = 0
): { origin_id: number; origin_slot: number } | null {
  if (depth > 64) return null
  const link = links.get(linkId)
  if (!link) return null
  const origin = nodeById.get(link.origin_id)
  if (!origin || origin.type !== 'Reroute') return { origin_id: link.origin_id, origin_slot: link.origin_slot }
  // origin 是 Reroute → 找它的输入连线继续回溯
  const rerouteInput = (origin.inputs || []).find((i) => i.link != null)
  if (!rerouteInput) return null
  return resolveLinkOrigin(rerouteInput.link as number, links, nodeById, depth + 1)
}

/** links 归一化：ComfyUI 格式为 6 元组，兼容历史上的对象形式 */
function normalizeLink(l: unknown): WorkflowLink | null {
  if (Array.isArray(l)) {
    const [id, origin_id, origin_slot, target_id, target_slot, type] = l as [
      number, number, number, number, number, string
    ]
    if (typeof id !== 'number') return null
    return { id, origin_id, origin_slot, target_id, target_slot, type }
  }
  if (l && typeof l === 'object' && typeof (l as WorkflowLink).id === 'number') return l as WorkflowLink
  return null
}

/** 控件值 → inputs：按 input_order 顺序把 widgets_values 贴到「可控件化」的输入上 */
export function workflowToPrompt(workflow: WorkflowJSON, defLookup: (type: string) => NodeDef | undefined): PromptOut {
  const prompt: PromptOut = {}
  const links = new Map<number, WorkflowLink>()
  for (const l of workflow.links || []) {
    const link = normalizeLink(l)
    if (link) links.set(link.id, link)
  }
  const nodeById = new Map<number, WorkflowNode>()
  for (const n of workflow.nodes || []) nodeById.set(n.id, n)

  // 输入端口名 → 连线
  const inputLinkByNode = new Map<number, Map<string, number>>()
  for (const n of workflow.nodes || []) {
    const m = new Map<string, number>()
    for (const inp of n.inputs || []) {
      if (inp.link != null && links.has(inp.link)) m.set(inp.name, inp.link)
    }
    inputLinkByNode.set(n.id, m)
  }

  for (const n of workflow.nodes || []) {
    if (n.type === 'Reroute') continue // Reroute 前端专用，执行时透传由引擎处理
    const def = defLookup(n.type)
    const inputs: Record<string, unknown> = {}
    const linkMap = inputLinkByNode.get(n.id)!

    // 1. 连线输入（优先；经过 Reroute 的连线回溯到真实上游）
    for (const [name, linkId] of linkMap) {
      const resolved = resolveLinkOrigin(linkId, links, nodeById)
      if (resolved) inputs[name] = [String(resolved.origin_id), resolved.origin_slot]
    }

    // 2. 控件值：按 def 的 required+optional 顺序，跳过已有连线的输入
    //    forceInput 的输入只有端口、不产生控件，不能占用 widgets_values 的位置
    const widgetValues = n.widgets_values || []
    const defInputs = def?.input || {}
    const order: string[] = []
    for (const key of ['required', 'optional'] as const) {
      const g = defInputs[key]
      if (!g) continue
      for (const [inName, spec] of Object.entries(g)) {
        const cfg = (Array.isArray(spec) ? spec[1] : undefined) as Record<string, unknown> | undefined
        if (cfg?.forceInput) continue
        const t = Array.isArray(spec) ? spec[0] : spec
        const isWidget = Array.isArray(t) || ['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COLOR', 'IMAGEUPLOAD'].includes(String(t))
        if (!isWidget) continue
        order.push(inName)
      }
    }
    let wi = 0
    for (const name of order) {
      if (name in inputs) continue
      const v = widgetValues[wi]
      wi++
      if (v !== undefined) inputs[name] = v
    }

    // 3. 前端动态附加输入（如聊天历史）
    const extra = (n.properties as { extra_inputs?: Record<string, unknown> } | undefined)?.extra_inputs
    const node: PromptNodeOut = { class_type: n.type, inputs }
    if (extra) (node as unknown as { _extra: Record<string, unknown> })._extra = extra
    if (n.properties && typeof n.properties === 'object' && 'title' in n.properties) {
      node._meta = { title: String((n.properties as { title?: unknown }).title) }
    }
    prompt[String(n.id)] = node
  }
  return prompt
}
