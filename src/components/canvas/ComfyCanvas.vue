<template>
  <div class="canvas-host" ref="host">
    <canvas class="minimap" ref="minimapEl" v-show="showMinimap"></canvas>

    <div class="executing-toast" v-if="store.exec.status === 'running' && store.exec.currentNode">
      <span class="spinner"></span>
      <span>{{ store.exec.currentNodeTitle || store.exec.currentNode }}</span>
    </div>

    <div class="drop-toast" v-if="dropToast">{{ dropToast }}</div>

    <NodeContextMenu
      v-if="nodeMenu"
      :req="nodeMenu"
      @close="nodeMenu = null"
      @rename="onRenameNode"
      @action="onNodeAction"
    />

    <NodeSearchBox
      v-if="searchFilter"
      :filter="searchFilter"
      @close="searchFilter = null"
      @add="onSearchAdd"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ComfyGraph, type SearchBoxFilter, type WorkflowJSON, type NodeMenuRequest, type MenuAction } from '../../engine/ComfyGraph'
import { uploadImageFile } from '../../engine/widgets'
import { useComfyStore } from '../../stores/comfyStore'
import type { FrontNodeDef } from '../../engine/nodeFactory'
import NodeSearchBox from '../dialogs/NodeSearchBox.vue'
import NodeContextMenu from './NodeContextMenu.vue'

const emit = defineEmits<{
  (e: 'dirty'): void
  (e: 'empty-change', empty: boolean): void
}>()

const store = useComfyStore()
const host = ref<HTMLElement>()
const minimapEl = ref<HTMLCanvasElement>()
const searchFilter = ref<SearchBoxFilter | null>(null)
const nodeMenu = ref<NodeMenuRequest | null>(null)
const showMinimap = ref(false)
const dropToast = ref('')
let toastTimer = 0
let graph: ComfyGraph | null = null

function toast(msg: string): void {
  dropToast.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { dropToast.value = '' }, 2600)
}

/** 找节点定义里「图片上传」输入（COMBO+image_upload 或 IMAGEUPLOAD 类型）的端口名 */
function imageUploadInputName(type: string): { name: string; isObject: boolean } | null {
  const def = store.nodeDefs[type] as FrontNodeDef | undefined
  if (!def) return null
  for (const grp of ['required', 'optional'] as const) {
    const g = def.input[grp]
    if (!g) continue
    for (const [name, spec] of Object.entries(g)) {
      const raw = spec as unknown as [unknown, Record<string, unknown>?]
      const t = raw[0]
      const cfg = raw[1] || {}
      if (t === 'IMAGEUPLOAD') return { name, isObject: true }
      if (cfg.image_upload) return { name, isObject: false }
    }
  }
  return null
}

defineExpose({
  getGraph: () => graph,
  serialize: (): WorkflowJSON | null => graph?.serialize() ?? null,
  loadWorkflow: (json: unknown) => graph?.loadWorkflow(json as WorkflowJSON),
  addNode: (type: string, pos: [number, number]) => graph?.addNode(type, pos),
  fitView: () => graph?.fitView(),
  connectNodes: (a: number, as: number, b: number, bs: number) =>
    graph?.connectNodes(a, as, b, bs) ?? { ok: false, error: '画布还没准备好' },
  clear: () => graph?.clear(),
  removeNode: (id: number) => graph?.removeNode(id),
  setWidgetValue: (id: number, name: string, value: unknown) => graph?.setWidgetValue(id, name, value) ?? false,
  summary: () => graph?.summary() ?? { nodes: [], links: [] },
  autoPos: (i: number) => graph?.autoPos(i) ?? [120, 120],
  isEmpty: () => !graph || Object.keys((graph.graph as unknown as { _nodes: Record<number, unknown> })._nodes).length === 0,
  /** 运行：返回提交结果（App 负责提示） */
  run: async (title?: string): Promise<{ ok: boolean; error?: string }> => {
    if (!graph) return { ok: false, error: '画布还没准备好' }
    if (Object.keys((graph.graph as unknown as { _nodes: Record<number, unknown> })._nodes).length === 0) {
      return { ok: false, error: '画布是空的：先添加节点再运行' }
    }
    graph.applySeedModes()
    const prompt = graph.toPrompt() as unknown as Record<string, unknown>
    return store.queuePrompt(prompt, title)
  }
})

onMounted(() => { void initGraph() })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

/** 快捷键：Ctrl+Enter 执行 / Ctrl+S 保存 */
function onKey(e: KeyboardEvent): void {
  const ae = document.activeElement as HTMLElement | null
  const typing = !!ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void (async () => {
      if (!graph) return
      graph.applySeedModes()
      const r = await store.queuePrompt(graph.toPrompt() as unknown as Record<string, unknown>, store.workflowName)
      if (!r.ok) toast(r.error || '提交失败')
    })()
  }
  if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('comfy:save'))
  }
  // Ctrl+G：把选中节点编成组（ComfyUI 同款）
  if (e.key.toLowerCase() === 'g' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    const gid = graph?.createGroupFromSelection()
    if (gid != null) toast('已创建组：拖动标题条可整体移动')
  }
  // Delete / Backspace：删除选中的全部节点（多选时一次性删掉）
  if ((e.key === 'Delete' || e.key === 'Backspace') && graph && !typing) {
    const sel = graph.selectedNodes()
    if (sel.length) {
      e.preventDefault()
      graph.removeNodes(sel.map((n) => n.id))
    }
  }
}

/** 异步初始化（loadRegistry 之后才建引擎；await 不得出现在 onMounted 回调内） */
async function initGraph(): Promise<void> {
  if (!host.value) return
  if (!store.registryLoaded) await store.loadRegistry()

  graph = new ComfyGraph(host.value, {
    onChatSend: (nodeId, message) => {
      const node = graph?.graph.getNodeById(nodeId)
      if (!node || !graph) return
      const props = node.properties as { extra_inputs?: { history?: Array<{ role: string; content: string }> } }
      props.extra_inputs = props.extra_inputs || {}
      const history = props.extra_inputs.history || []
      history.push({ role: 'user', content: message })
      props.extra_inputs.history = history
      graph.applySeedModes()
      void store.queuePrompt(graph.toPrompt() as unknown as Record<string, unknown>, store.workflowName)
    },
    onRefreshProviders: () => { void store.loadLLMProviders() }
  })

  const defs = Object.values(store.nodeDefs) as FrontNodeDef[]
  graph.registerDefs(defs)
  graph.onChange = () => emit('dirty')
  console.log('[comfy] 引擎就绪，注册节点类型:', defs.length)

  store.onNodeExecuting((nodeId, active) => graph?.setNodeExecuting(nodeId, active))
  store.onNodeOutput((nodeId, _type, output) => graph?.updateNodeOutput(nodeId, output))
  store.connectWS()

  graph.onOpenSearchBox = (filter) => { searchFilter.value = filter }

  // 拖入 .json 工作流文件 → 打开
  graph.onDropWorkflowFile = async (file) => {
    const r = await store.openWorkflowFromFile(file)
    if (!r.ok) { toast(`打开失败：${r.error}`); return }
    const json = JSON.parse(await file.text())
    graph?.loadWorkflow(json)
    toast(`已打开「${file.name}」（${r.nodeCount} 个节点）`)
  }

  // 拖入图片 → 命中图片输入节点则回填，否则新建 LoadImage
  graph.onDropImageFile = async (file, pos, hitNodeId) => {
    let serverName: string
    try {
      serverName = await uploadImageFile(file)
    } catch {
      toast('图片上传失败')
      return
    }
    if (hitNodeId != null) {
      const node = graph?.graph.getNodeById(hitNodeId)
      const spec = node ? imageUploadInputName(node.type!) : null
      if (node && spec && graph?.setWidgetValue(hitNodeId, spec.name, spec.isObject ? { filename: serverName, subfolder: '', type: 'input' } : serverName)) {
        toast(`已填入「${node.title}」`)
        return
      }
    }
    const node = graph?.addNode('LoadImage', pos)
    if (node && graph?.setWidgetValue(node.id, 'image', serverName)) {
      toast(`已创建「加载图像」节点：${serverName}`)
    }
  }

  if (minimapEl.value) graph.attachMinimap(minimapEl.value)
  minimapEl.value?.addEventListener('dblclick', (e) => e.stopPropagation())

  window.addEventListener('keydown', onKey)

  // 右键节点 → 自定义菜单；双击标题 → 直接进入重命名
  graph.onNodeContextMenu = (req) => { nodeMenu.value = req }

  // API 服务商：把设置里的服务商列表注入画布（节点控件实时读取）
  graph.setProviders(store.llmProviders)
}

function onRenameNode(title: string): void {
  const req = nodeMenu.value
  if (req) {
    if (req.kind === 'group' && req.groupId != null) graph?.renameGroup(req.groupId, title)
    else graph?.renameNode(req.nodeId, title)
  }
  nodeMenu.value = null
  toast(req?.kind === 'group' ? '组已重命名' : '节点已重命名')
}

function onNodeAction(payload: MenuAction): void {
  const req = nodeMenu.value
  if (!req) return
  // ---- 组菜单 ----
  if (req.kind === 'group' && req.groupId != null) {
    const gid = req.groupId
    switch (payload.type) {
      case 'color': graph?.applyGroupAction(gid, 'color', payload.color ?? null); break
      case 'bypass': graph?.applyGroupAction(gid, 'bypass'); break
      case 'unbypass': graph?.applyGroupAction(gid, 'unbypass'); break
      case 'select': graph?.applyGroupAction(gid, 'select'); break
      case 'fit': graph?.applyGroupAction(gid, 'fit'); break
      case 'ungroup': graph?.applyGroupAction(gid, 'ungroup'); break
      case 'deleteAll': graph?.deleteGroup(gid, false); break
    }
    nodeMenu.value = null
    return
  }
  // ---- 节点菜单（多选时对全部目标生效）----
  const ids = req.targets?.length ? req.targets : [req.nodeId]
  switch (payload.type) {
    case 'delete': graph?.removeNodes(ids); break
    case 'bypass': graph?.setNodesBypassed(ids, !req.bypassed); break
    case 'unbypass': graph?.setNodesBypassed(ids, false); break
    case 'collapse': graph?.toggleCollapse(req.nodeId); break
    case 'clone': graph?.cloneById(req.nodeId); break
    case 'color': graph?.setNodesColor(ids, payload.color ?? null); break
    case 'group': graph?.createGroupFromSelection(); break
  }
  nodeMenu.value = null
}

// 设置里新增/启用服务商后，画布上的「API 服务商」节点立即刷新
watch(
  () => store.llmProviders,
  (list) => graph?.setProviders(list),
  { deep: true }
)

function onSearchAdd(type: string, filter: SearchBoxFilter): void {
  graph?.addNodeFromSearch(type, filter)
  searchFilter.value = null
}
</script>

<style scoped>
.spinner {
  width: 11px;
  height: 11px;
  border: 2px solid #85b6ff;
  border-top-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.drop-toast {
  position: absolute;
  left: 50%;
  bottom: 42px;
  transform: translateX(-50%);
  background: rgba(20, 23, 28, 0.96);
  border: 1px solid #3b6ea8;
  color: #dbe6f3;
  font-size: 12px;
  padding: 7px 14px;
  border-radius: 6px;
  z-index: 30;
  pointer-events: none;
  white-space: nowrap;
}
</style>
