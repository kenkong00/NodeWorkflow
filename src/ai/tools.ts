/**
 * AI 工具执行器：名字与服务端 server/agent/chat.ts 的 AGENT_TOOLS 一一对应。
 * 全部在浏览器里真实执行（改的是用户看得见的那块画布），结果回传给模型继续推理。
 */
import { canvas } from './bridge'
import { useComfyStore } from '../stores/comfyStore'

export interface ToolResult {
  tool_call_id: string
  name: string
  content: string
}

type Args = Record<string, unknown>

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function brief(v: unknown, max = 1600): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v, (_k, val) => (typeof val === 'object' && val !== null && (val as { filename?: string }).filename ? '[image]' : val))
  return s.length > max ? `${s.slice(0, max)}…（已截断）` : s
}

export async function runTool(name: string, args: Args, toolCallId: string): Promise<ToolResult> {
  const store = useComfyStore()
  let content = ''
  try {
    switch (name) {
      case 'list_node_types': {
        const filter = String(args.filter || '').trim().toLowerCase()
        const limit = Math.max(1, Math.min(200, num(args.limit, 60)))
        const defs = store.visibleNodeDefs
          .filter((d) => !filter || `${d.name} ${d.display_name} ${d.category}`.toLowerCase().includes(filter))
          .slice(0, limit)
          .map((d) => ({
            name: d.name,
            display_name: d.display_name,
            category: d.category,
            description: d.description,
            inputs: [
              ...Object.entries(d.input?.required || {}).map(([k, v]) => `${k}:${Array.isArray(v[0]) ? 'COMBO' : v[0]}`),
              ...Object.entries(d.input?.optional || {}).map(([k, v]) => `${k}?:${Array.isArray(v[0]) ? 'COMBO' : v[0]}`)
            ],
            outputs: d.output || []
          }))
        content = JSON.stringify({ count: defs.length, nodes: defs })
        break
      }

      case 'get_canvas': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const s = c.summary()
        content = JSON.stringify({
          nodeCount: s.nodes.length,
          nodes: s.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            inputs: n.inputs.map((i, idx) => `${idx}:${i.name}(${i.type})${i.linked ? '[已连接]' : ''}`),
            outputs: n.outputs.map((o, idx) => `${idx}:${o.name}(${o.type})`),
            widgets: n.widgets.filter((w) => w.value !== undefined && w.value !== null && w.value !== '')
          })),
          links: s.links
        })
        break
      }

      case 'add_node': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const type = String(args.type || '')
        if (!type) {
          content = '缺少 type'
          break
        }
        const s = c.summary()
        const pos: [number, number] =
          args.x !== undefined && args.y !== undefined ? [num(args.x), num(args.y)] : c.autoPos(s.nodes.length)
        const node = c.addNode(type, pos) as { id: number; inputs?: Array<{ name: string; type: string }>; outputs?: Array<{ name: string; type: string }> } | null
        if (!node) {
          content = `添加失败：节点类型「${type}」不存在`
          break
        }
        content = JSON.stringify({
          ok: true,
          id: node.id,
          type,
          inputs: (node.inputs || []).map((i, idx) => `${idx}:${i.name}(${i.type})`),
          outputs: (node.outputs || []).map((o, idx) => `${idx}:${o.name}(${o.type})`)
        })
        break
      }

      case 'connect_nodes': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const r = c.connectNodes(num(args.from_id), num(args.from_slot), num(args.to_id), num(args.to_slot))
        content = JSON.stringify(r)
        break
      }

      case 'set_widget_value': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const g = c.getGraph() as { setWidgetValue?: (id: number, name: string, value: unknown) => boolean } | null
        if (!g?.setWidgetValue) {
          content = '当前画布不支持设置控件'
          break
        }
        const ok = g.setWidgetValue(num(args.node_id), String(args.name || ''), args.value)
        content = JSON.stringify({ ok })
        break
      }

      case 'remove_node': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const g = c.getGraph() as { removeNode?: (id: number) => void } | null
        g?.removeNode?.(num(args.node_id))
        content = JSON.stringify({ ok: true })
        break
      }

      case 'clear_canvas': {
        const c = canvas()
        c?.clear()
        content = JSON.stringify({ ok: true })
        break
      }

      case 'fit_view': {
        canvas()?.fitView()
        content = JSON.stringify({ ok: true })
        break
      }

      case 'list_workflows': {
        await store.loadWorkflowList()
        const folder = String(args.folder || '').trim()
        const list = store.workflows.filter((w) => !folder || (w.folder || '') === folder)
        content = JSON.stringify({ count: list.length, workflows: list.map((w) => ({ id: w.id, name: w.name, folder: w.folder || '', nodeCount: w.nodeCount ?? 0 })) })
        break
      }

      case 'open_workflow': {
        const c = canvas()
        const id = String(args.id || '')
        if (!id) {
          content = '缺少 id'
          break
        }
        const graph = (await store.openWorkflow(id)) as Record<string, unknown>
        c?.loadWorkflow(graph)
        content = JSON.stringify({ ok: true, id, name: store.workflowName })
        break
      }

      case 'run_workflow': {
        const c = canvas()
        if (!c) {
          content = '画布还没准备好'
          break
        }
        const r = await c.run(store.workflowName)
        content = JSON.stringify(r)
        break
      }

      case 'save_workflow': {
        const c = canvas()
        const g = c?.serialize()
        if (!g?.nodes?.length) {
          content = '画布是空的，没有可保存的内容'
          break
        }
        const name = String(args.name || store.workflowName || '未命名工作流')
        const folder = String(args.folder || '').trim()
        const id = folder ? await store.saveWorkflowAs(g, name, folder) : await store.saveWorkflowTo(store.currentWorkflowId || '', g, name)
        content = JSON.stringify({ ok: true, name, id })
        break
      }

      default:
        content = `未知工具：${name}`
    }
  } catch (e) {
    content = `执行出错：${(e as Error).message}`
  }
  return { tool_call_id: toolCallId, name, content: brief(content) }
}
