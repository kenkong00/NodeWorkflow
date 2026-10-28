<template>
  <div class="app-shell">
    <TopBar
      :ai-open="ai.open"
      @select-tab="switchTab"
      @close-tab="closeTab"
      @new="newWorkflow"
      @run="run"
      @rename-tab="renameTab"
      @toggle-ai="ai.toggle()"
    />

    <div class="app-body">
      <LeftRail
        :panel-open="panelOpen"
        :panel-mode="panelMode"
        @new="newWorkflow"
        @save="save"
        @save-as="saveAs"
        @toggle-panel="onTogglePanel"
        @fit="canvasRef?.fitView()"
        @plugins="pluginDialog = true"
        @settings="settingsDialog = true"
      />
      <LeftPanel
        v-if="panelOpen && panelMode === 'nodes'"
        @add-node="onAddNode"
        @toggle-panel="panelOpen = false"
      />
      <WorkflowBrowser
        v-if="panelOpen && panelMode === 'workflows'"
        @open-file="openSaved"
        @open-example="openExample"
        @toggle-panel="panelOpen = false"
        @import-file="openFileFromDisk"
      />
      <ComfyCanvas ref="canvasRef" @dirty="onDirty" />

      <!-- AI 助手：悬浮在画布右侧 -->
      <AiChatPanel v-if="ai.open" />
    </div>

    <QueueBar />

    <div v-if="hint" class="app-hint" :class="hintKind">{{ hint }}</div>

    <SettingsDialog v-if="settingsDialog" @close="settingsDialog = false" @providers-changed="onProvidersChanged" />
    <PluginManagerDialog v-if="pluginDialog" @close="pluginDialog = false" />

    <SaveAsDialog
      v-if="saveAsDialog"
      :default-name="saveAsName"
      :list="store.workflows"
      :current-id="store.currentWorkflowId"
      @close="saveAsDialog = false"
      @save="doSaveAs"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import TopBar from './components/layout/TopBar.vue'
import LeftRail from './components/layout/LeftRail.vue'
import LeftPanel from './components/layout/LeftPanel.vue'
import WorkflowBrowser from './components/layout/WorkflowBrowser.vue'
import ComfyCanvas from './components/canvas/ComfyCanvas.vue'
import QueueBar from './components/layout/QueueBar.vue'
import AiChatPanel from './components/ai/AiChatPanel.vue'
import SettingsDialog from './components/dialogs/SettingsDialog.vue'
import PluginManagerDialog from './components/dialogs/PluginManagerDialog.vue'
import SaveAsDialog from './components/dialogs/SaveAsDialog.vue'
import { useComfyStore } from './stores/comfyStore'
import { useTabsStore } from './stores/useTabsStore'
import { useAiStore } from './stores/useAiStore'
import { setCanvasBridge } from './ai/bridge'
import type { WorkflowJSON } from './engine/ComfyGraph'
import './styles/comfy-theme.css'

const store = useComfyStore()
const tabs = useTabsStore()
const ai = useAiStore()
const canvasRef = ref<InstanceType<typeof ComfyCanvas> | null>(null)

/** 侧边面板状态持久化：刷新后保持上次的开合与节点库/打开工作流选择（默认展开） */
const PANEL_KEY = 'comfy.panel.v1'
function loadPanelState(): { open: boolean; mode: 'nodes' | 'workflows' } {
  try {
    const s = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}') as { open?: boolean; mode?: string }
    return { open: s.open !== false, mode: s.mode === 'workflows' ? 'workflows' : 'nodes' }
  } catch {
    return { open: true, mode: 'nodes' }
  }
}
const panelState = loadPanelState()
const panelOpen = ref(panelState.open)
/** 左侧面板当前显示什么：节点库 / 打开工作流（互斥切换） */
const panelMode = ref<'nodes' | 'workflows'>(panelState.mode)
watch([panelOpen, panelMode], () => {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ open: panelOpen.value, mode: panelMode.value }))
  } catch {
    /* 忽略 */
  }
})
const settingsDialog = ref(false)
const pluginDialog = ref(false)
const saveAsDialog = ref(false)
const saveAsName = ref('')
const hint = ref('')
const hintKind = ref<'info' | 'error'>('info')
let hintTimer = 0

function showHint(msg: string, kind: 'info' | 'error' = 'info'): void {
  hint.value = msg
  hintKind.value = kind
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => { hint.value = '' }, 3200)
}

const EMPTY_GRAPH: WorkflowJSON = { last_node_id: 0, last_link_id: 0, nodes: [], links: [] }

onMounted(async () => {
  await store.loadRegistry()
  // 刷新自动恢复：若存在未保存草稿，先塞进当前标签页，再同步进画布
  const draft = store.loadDraft()
  if (draft) {
    tabs.updateTab(tabs.activeId, {
      graph: draft.graph,
      name: draft.name,
      workflowId: draft.file,
      dirty: draft.dirty
    })
    store.currentWorkflowId = draft.file
    store.workflowName = draft.name
  }
  void store.loadLLMProviders()
  void store.loadWorkflowList()
  void store.loadPlugins()
  window.addEventListener('beforeunload', flushDraft)
  // 首帧后再载入（ComfyCanvas 的引擎是异步初始化的）
  window.setTimeout(() => syncCanvasFromTab(), 260)
})

onBeforeUnmount(() => window.removeEventListener('beforeunload', flushDraft))

/** 把当前画布状态落盘到 localStorage（未保存也能刷新恢复） */
let draftTimer = 0
function flushDraft(): void {
  store.persistDraft(canvasRef.value?.serialize(), tabs.active?.dirty ?? false)
}
function persistCurrent(): void {
  store.persistDraft(canvasRef.value?.serialize(), tabs.active?.dirty ?? false)
}

/** 等待画布引擎就绪（最多 ~3s） */
async function waitCanvas(): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (canvasRef.value?.getGraph()) return true
    await new Promise((r) => setTimeout(r, 80))
  }
  return false
}

/** 把当前标签的快照载入画布 */
async function syncCanvasFromTab(): Promise<void> {
  if (!(await waitCanvas())) return
  const t = tabs.active
  store.currentWorkflowId = t?.workflowId ?? null
  store.workflowName = t?.name ?? '未命名工作流'
  await nextTick()
  canvasRef.value?.loadWorkflow(t?.graph ?? EMPTY_GRAPH)
  persistCurrent()
}

/** 切换标签：先保存当前快照，再载入目标 */
async function switchTab(id: string): Promise<void> {
  if (id === tabs.activeId) return
  const cur = tabs.active
  if (cur) {
    tabs.updateTab(cur.id, {
      graph: canvasRef.value?.serialize() ?? cur.graph,
      name: store.workflowName,
      workflowId: store.currentWorkflowId
    })
  }
  tabs.activeId = id
  await syncCanvasFromTab()
}

async function closeTab(id: string): Promise<void> {
  const wasActive = id === tabs.activeId
  const nextId = tabs.closeTab(id)
  if (!wasActive || !nextId) return
  tabs.activeId = nextId
  await syncCanvasFromTab()
}

async function newWorkflow(): Promise<void> {
  const cur = tabs.active
  if (cur) {
    tabs.updateTab(cur.id, { graph: canvasRef.value?.serialize() ?? cur.graph, name: store.workflowName })
  }
  const t = tabs.addTab('未命名工作流')
  store.currentWorkflowId = null
  store.workflowName = t.name
  await syncCanvasFromTab()
  showHint('已新建工作流标签页')
}

function onDirty(): void {
  if (tabs.active?.dirty) return
  tabs.markDirty(tabs.activeId, true)
  // 防抖写入 localStorage：刷新浏览器也能恢复未保存的工作流
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => store.persistDraft(canvasRef.value?.serialize(), true), 700)
}

async function save(): Promise<void> {
  const graph = canvasRef.value?.serialize()
  if (!graph) return
  if (!graph.nodes?.length) {
    showHint('画布是空的：右键画布（或从左侧节点库拖入）先添加节点', 'error')
    return
  }
  // 从没保存过 → 按桌面软件惯例走「另存为」（让用户先命名）
  if (!store.currentWorkflowId) {
    openSaveAs()
    return
  }
  try {
    const id = await store.saveWorkflow(graph, store.workflowName)
    tabs.updateTab(tabs.activeId, { workflowId: id, name: store.workflowName, graph, dirty: false })
    persistCurrent()
    showHint(`已保存「${store.workflowName}」`)
  } catch (e) {
    showHint(`保存失败：${(e as Error).message}`, 'error')
  }
}

/** 打开「另存为」对话框（默认名 = 原名 + 副本，重名自动加序号） */
function openSaveAs(): void {
  const graph = canvasRef.value?.serialize()
  if (!graph?.nodes?.length) {
    showHint('画布是空的，没有可保存的内容', 'error')
    return
  }
  const base = store.workflowName.replace(/\s*副本(\s*\d+)?$/, '')
  let candidate = `${base} 副本`
  let i = 2
  while (store.workflows.some((w) => w.name === candidate)) {
    candidate = `${base} 副本 ${i}`
    i += 1
  }
  saveAsName.value = candidate
  saveAsDialog.value = true
}

const saveAs = openSaveAs

/** 「另存为」对话框确认：新建，或覆盖同名工作流 */
async function doSaveAs(payload: { name: string; overwriteId: string | null }): Promise<void> {
  const graph = canvasRef.value?.serialize()
  if (!graph) return
  saveAsDialog.value = false
  try {
    const id = payload.overwriteId
      ? await store.saveWorkflowTo(payload.overwriteId, graph, payload.name)
      : await store.saveWorkflowAs(graph, payload.name)
    store.currentWorkflowId = id
    store.workflowName = payload.name
    tabs.updateTab(tabs.activeId, { workflowId: id, name: payload.name, graph, dirty: false })
    await store.loadWorkflowList()
    persistCurrent()
    showHint(payload.overwriteId ? `已覆盖保存「${payload.name}」` : `已另存为「${payload.name}」`)
  } catch (e) {
    showHint(`另存失败：${(e as Error).message}`, 'error')
  }
}

/** 标签双击重命名：内存立即生效，已保存的工作流同步改名（文件名即身份） */
async function renameTab(payload: { id: string; name: string }): Promise<void> {
  tabs.updateTab(payload.id, { name: payload.name })
  if (payload.id !== tabs.activeId) return
  store.workflowName = payload.name
  if (store.currentWorkflowId) {
    try {
      await store.renameWorkflow(store.currentWorkflowId, payload.name)
      // 文件名即身份，改名后同步当前工作流 id
      store.currentWorkflowId = payload.name
    } catch {
      /* 改名失败不阻断本地使用，下次保存会写回 */
    }
  }
  persistCurrent()
  showHint(`已重命名为「${payload.name}」`)
}

async function run(): Promise<void> {
  const r = await canvasRef.value?.run(store.workflowName)
  if (!r) return
  if (!r.ok) {
    showHint(r.error || '提交失败', 'error')
    return
  }
  showHint('任务已提交，运行结果会显示在节点上')
}

function onAddNode(type: string): void {
  const g = canvasRef.value?.getGraph?.()
  const va = g?.canvas.visible_area
  const pos: [number, number] = va ? [va[0] + va[2] / 2 - 160, va[1] + va[3] / 2 - 80] : [200, 200]
  canvasRef.value?.addNode(type, pos)
}

async function openSaved(id: string): Promise<void> {
  const exist = tabs.findByWorkflowId(id)
  if (exist) {
    await switchTab(exist.id)
    return
  }
  const cur = tabs.active
  if (cur) tabs.updateTab(cur.id, { graph: canvasRef.value?.serialize() ?? cur.graph, name: store.workflowName })
  const json = (await store.openWorkflow(id)) as WorkflowJSON
  const t = tabs.addTab(store.workflowName, json, id)
  store.currentWorkflowId = id
  store.workflowName = t.name
  await syncCanvasFromTab()
  showHint(`已打开「${t.name}」`)
}

const EXAMPLES = [
  { file: '01-文本传递.json', name: '文本传递', desc: '文本输入 → 文本显示' },
  { file: '02-数值运算.json', name: '数值运算', desc: '两个数值 → 数学运算 → 显示' },
  { file: '03-图像预览.json', name: '图像预览', desc: '加载图像 → 预览（含尺寸）' },
  { file: '04-三链合一.json', name: '三链合一（推荐）', desc: '文本 + 数值 + 图像，点运行看结果' }
]

async function openExample(ex: { file: string; name: string }): Promise<void> {
  try {
    const res = await fetch(`/examples/${ex.file}`)
    const json = (await res.json()) as WorkflowJSON
    const cur = tabs.active
    if (cur) tabs.updateTab(cur.id, { graph: canvasRef.value?.serialize() ?? cur.graph, name: store.workflowName })
    const t = tabs.addTab(ex.name, json, null)
    store.currentWorkflowId = null
    store.workflowName = t.name
    await syncCanvasFromTab()
    showHint(`已打开示例「${ex.name}」`)
  } catch {
    showHint(`示例加载失败：${ex.name}`, 'error')
  }
}

/** 从本地 .json 打开（侧边「打开工作流」面板的导入按钮） */
async function openFileFromDisk(file: File): Promise<void> {
  const r = await store.openWorkflowFromFile(file)
  if (!r.ok) {
    showHint(`打开失败：${r.error}`, 'error')
    return
  }
  const json = JSON.parse(await file.text()) as WorkflowJSON
  const cur = tabs.active
  if (cur) tabs.updateTab(cur.id, { graph: canvasRef.value?.serialize() ?? cur.graph, name: store.workflowName })
  const t = tabs.addTab(store.workflowName, json, null)
  store.currentWorkflowId = null
  store.workflowName = t.name
  await syncCanvasFromTab()
  showHint(`已打开「${t.name}」（${r.nodeCount} 个节点）`)
}

/** 左侧面板互斥切换：节点库 / 打开工作流 */
function onTogglePanel(mode: 'nodes' | 'workflows'): void {
  if (panelMode.value === mode && panelOpen.value) {
    panelOpen.value = false
    return
  }
  panelMode.value = mode
  panelOpen.value = true
  if (mode === 'workflows') void store.loadWorkflowTree()
}

function onProvidersChanged(): void {
  // 设置里改了供应商 → 设置列表刷新，AI 助手的供应商下拉也要跟着刷新（否则下拉里还是旧列表）
  void store.loadLLMProviders()
  void ai.loadProviders()
}

// 画布引擎就绪后，把操作能力暴露给 AI 工具（AI 直接操作真实画布）
watch(canvasRef, (c) => {
  if (!c) return
  setCanvasBridge({
    getGraph: () => c.getGraph(),
    addNode: (type: string, pos?: [number, number]) =>
      c.addNode(type, pos ?? c.autoPos(c.summary().nodes.length)),
    connectNodes: (a, as, b, bs) => c.connectNodes(a, as, b, bs),
    setWidgetValue: (id, name, value) => c.setWidgetValue(id, name, value),
    removeNode: (id) => c.removeNode(id),
    clear: () => c.clear(),
    fitView: () => c.fitView(),
    summary: () => c.summary(),
    serialize: () => c.serialize(),
    loadWorkflow: (json) => c.loadWorkflow(json),
    autoPos: (i) => c.autoPos(i),
    run: (name?) => c.run(name)
  })
}, { immediate: true })

// Ctrl+S / Ctrl+Enter 由画布派发，这里统一处理保存
window.addEventListener('comfy:save', () => void save())
</script>

<style scoped>
.app-hint {
  position: fixed;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: #1b2027;
  border: 1px solid #3b6ea8;
  color: #e6eef8;
  font-size: 12.5px;
  padding: 8px 16px;
  border-radius: 7px;
  z-index: 120;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  max-width: 70vw;
  white-space: pre-line;
  line-height: 1.6;
  text-align: left;
}
.app-hint.error { border-color: #a83b3b; color: #ffd7d7; }

.x-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: #8b95a3;
  cursor: pointer;
}
.x-btn:hover { background: #2a2f37; color: #fff; }

.open-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  color: #cfd8e3;
  font-size: 12.5px;
}
.open-row:hover { background: #232a33; }
.open-row svg { color: #7d8794; flex: none; }
.or-name { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.or-desc { margin-left: auto; font-size: 11px; color: #7d8794; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.or-del {
  background: transparent;
  border: 0;
  color: #7d8794;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: inline-flex;
}
.or-del:hover { color: #ff8e8e; background: #3a2222; }
.open-empty { color: #6d7683; font-size: 12px; padding: 14px; text-align: center; }
</style>
