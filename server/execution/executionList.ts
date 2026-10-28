/**
 * 执行列表（拓扑调度 + 环检测）—— 复刻 ComfyUI comfy_execution/graph.py
 *  - strong link：数据依赖（必须等上游执行完）
 *  - getReadyNodes：入度归零的节点
 *  - 无就绪节点但图非空 → DependencyCycleError，并定位环上节点
 */

export class DependencyCycleError extends Error {
  cycleNodes: string[]
  constructor(cycleNodes: string[]) {
    super('Dependency cycle detected')
    this.name = 'DependencyCycleError'
    this.cycleNodes = cycleNodes
  }
}

interface NodeEntry {
  id: string
  /** 未满足的强依赖数量 */
  pending: number
  /** 依赖我的节点 */
  dependents: string[]
  /** 我依赖的节点 */
  dependencies: Set<string>
  done: boolean
}

export class ExecutionList {
  private nodes = new Map<string, NodeEntry>()

  get size(): number {
    return this.nodes.size
  }

  isEmpty(): boolean {
    for (const n of this.nodes.values()) if (!n.done) return false
    return true
  }

  addNode(id: string, dependencies: Iterable<string>): void {
    if (this.nodes.has(id)) return
    this.nodes.set(id, { id, pending: 0, dependents: [], dependencies: new Set(dependencies), done: false })
    // 该节点依赖的节点可能已注册 → 登记双向关系
    for (const dep of dependencies) {
      if (this.nodes.has(dep)) {
        const d = this.nodes.get(dep)!
        d.dependents.push(id)
        this.nodes.get(id)!.pending++
      }
    }
    // 已注册的节点可能依赖该节点 → 补登记
    for (const n of this.nodes.values()) {
      if (n.id !== id && n.dependencies.has(id)) {
        n.pending++
        this.nodes.get(id)!.dependents.push(n.id)
      }
    }
  }

  /** 标记节点完成，返回新就绪的节点 */
  completeNode(id: string): string[] {
    const n = this.nodes.get(id)
    if (!n || n.done) return []
    n.done = true
    const ready: string[] = []
    for (const dep of n.dependents) {
      const d = this.nodes.get(dep)
      if (!d || d.done) continue
      d.pending--
      if (d.pending <= 0) ready.push(dep)
    }
    return ready
  }

  /** 就绪节点（输出节点优先，复刻 ux_friendly_pick_node） */
  getReadyNodes(isOutput: (id: string) => boolean): string[] {
    const ready: string[] = []
    for (const n of this.nodes.values()) {
      if (!n.done && n.pending <= 0) ready.push(n.id)
    }
    ready.sort((a, b) => Number(isOutput(b)) - Number(isOutput(a)))
    return ready
  }

  /** 定位环上节点（复刻 get_nodes_in_cycle：反复剥离无依赖节点） */
  getNodesInCycle(): string[] {
    const remaining = new Map<string, NodeEntry>()
    for (const [id, n] of this.nodes) {
      if (!n.done) remaining.set(id, { ...n, dependencies: new Set(n.dependencies) })
    }
    let changed = true
    while (changed) {
      changed = false
      for (const [id, n] of [...remaining]) {
        // 无未完成依赖 → 可执行，剥离
        const openDeps = [...n.dependencies].filter((d) => remaining.has(d) && !remaining.get(d)!.done)
        if (openDeps.length === 0) {
          remaining.delete(id)
          changed = true
        }
      }
    }
    return [...remaining.keys()]
  }

  /** 若无可就绪节点但图非空，抛 DependencyCycleError */
  ensureNoDeadlock(isOutput: (id: string) => boolean): void {
    if (this.isEmpty()) return
    if (this.getReadyNodes(isOutput).length > 0) return
    throw new DependencyCycleError(this.getNodesInCycle())
  }
}
