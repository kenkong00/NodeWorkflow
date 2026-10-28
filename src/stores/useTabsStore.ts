/**
 * 多标签页状态 —— 每个标签 = 一个独立工作流
 *
 * 只存数据（名称/服务端 id/序列化快照），画布只有一个实例：
 * 切换标签时由 App.vue 先 serialize 当前画布写回标签，再把目标标签的快照 load 进画布。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface WorkflowTab {
  /** 本地标签 id（稳定，不随保存变化） */
  id: string
  /** 服务端工作流 id（未保存为 null） */
  workflowId: string | null
  name: string
  /** 序列化快照（切换标签时保存/恢复用） */
  graph: unknown | null
  /** 有未保存改动 */
  dirty: boolean
}

let seq = 0
function newId(): string {
  seq += 1
  return `tab-${Date.now().toString(36)}-${seq}`
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<WorkflowTab[]>([
    { id: newId(), workflowId: null, name: '未命名工作流', graph: null, dirty: false }
  ])
  const activeId = ref<string>(tabs.value[0].id)

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) || null)
  const activeIndex = computed(() => tabs.value.findIndex((t) => t.id === activeId.value))

  function addTab(name = '未命名工作流', graph: unknown | null = null, workflowId: string | null = null): WorkflowTab {
    const tab: WorkflowTab = { id: newId(), workflowId, name, graph, dirty: false }
    tabs.value.push(tab)
    activeId.value = tab.id
    return tab
  }

  function closeTab(id: string): string | null {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return activeId.value
    const wasActive = tabs.value[idx].id === activeId.value
    if (tabs.value.length === 1) {
      // 最后一个标签：清空而不是关掉（ComfyUI 行为）
      const t = tabs.value[0]
      t.name = '未命名工作流'
      t.graph = null
      t.workflowId = null
      t.dirty = false
      return t.id
    }
    tabs.value.splice(idx, 1)
    if (wasActive) {
      const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
      activeId.value = next.id
      return next.id
    }
    return activeId.value
  }

  function updateTab(id: string, patch: Partial<WorkflowTab>): void {
    const t = tabs.value.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
  }

  function markDirty(id: string, dirty = true): void {
    const t = tabs.value.find((x) => x.id === id)
    if (t) t.dirty = dirty
  }

  /** 按服务端工作流 id 找已打开的标签（避免重复打开） */
  function findByWorkflowId(workflowId: string): WorkflowTab | null {
    return tabs.value.find((t) => t.workflowId === workflowId) || null
  }

  return { tabs, activeId, active, activeIndex, addTab, closeTab, updateTab, markDirty, findByWorkflowId }
})
