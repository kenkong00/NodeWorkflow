/**
 * 画布桥接层：AI 工具需要操作画布，但画布实例住在 Vue 组件里。
 * 这里用一个模块级单例做中转，App 挂载时把 ComfyCanvas 暴露的方法注册进来。
 */
export interface CanvasBridge {
  getGraph: () => unknown
  serialize: () => { last_node_id: number; last_link_id: number; nodes: unknown[]; links: unknown[] } | null
  loadWorkflow: (json: unknown) => void
  addNode: (type: string, pos?: [number, number]) => unknown
  fitView: () => void
  connectNodes: (fromId: number, fromSlot: number, toId: number, toSlot: number) => { ok: boolean; error?: string }
  clear: () => void
  removeNode: (id: number) => void
  setWidgetValue: (id: number, name: string, value: unknown) => boolean
  summary: () => {
    nodes: Array<{
      id: number
      type: string
      title: string
      pos: [number, number]
      inputs: Array<{ name: string; type: string; linked: boolean }>
      outputs: Array<{ name: string; type: string }>
      widgets: Array<{ name: string; value: unknown }>
    }>
    links: unknown[]
  }
  autoPos: (index: number) => [number, number]
  run: (title?: string) => Promise<{ ok: boolean; error?: string }>
}

let bridge: CanvasBridge | null = null

export function setCanvasBridge(b: CanvasBridge | null): void {
  bridge = b
}

export function canvas(): CanvasBridge | null {
  return bridge
}
