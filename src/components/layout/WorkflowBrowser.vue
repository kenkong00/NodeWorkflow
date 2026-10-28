<template>
  <aside class="wf-panel">
    <div class="wf-head">
      <span class="wf-title">打开工作流</span>
      <span class="wf-count">{{ totalFiles }}</span>
      <div class="wf-head-actions">
        <button class="wf-icon" title="新建文件夹" @click="startNewFolder('')">
          <FolderPlus :size="16" :stroke-width="1.9" />
        </button>
        <button class="wf-icon" title="刷新" @click="refresh">
          <RefreshCw :size="16" :stroke-width="1.9" />
        </button>
        <button class="wf-icon" title="收起面板" @click="$emit('toggle-panel')">
          <ChevronLeft :size="17" :stroke-width="1.9" />
        </button>
      </div>
    </div>

    <div class="wf-search">
      <Search :size="13" :stroke-width="2" />
      <input v-model="query" placeholder="搜索工作流…" spellcheck="false" />
      <button v-if="query" class="wf-clear" title="清空" @click="query = ''">
        <X :size="12" />
      </button>
    </div>

    <button class="wf-import" @click="pickLocalFile">
      <Upload :size="14" :stroke-width="1.9" />
      <span>从本地文件打开（.json）</span>
    </button>
    <input ref="fileEl" type="file" accept=".json,application/json" style="display:none" @change="onFile" />

    <div class="wf-body">
      <!-- 根目录 -->
      <div v-if="creating === '__root__'" class="wf-newrow">
        <FolderPlus :size="13" />
        <input
          ref="newFolderEl"
          v-model="newFolderName"
          class="wf-newinput"
          placeholder="文件夹名称"
          @keydown.enter.prevent="commitRootFolder"
          @keydown.esc.prevent="creating = null"
          @blur="commitRootFolder"
        />
      </div>

      <WorkflowFolderNode
        v-for="f in tree.folders"
        :key="f.path"
        :node="f"
        :depth="0"
        :expanded="expanded"
        :query="q"
        :creating="creating"
        @toggle="toggle"
        @open="$emit('open-file', $event)"
        @new-folder="startNewFolder"
        @rename="renameFolder"
        @delete="removeFolder"
        @delete-file="removeFile"
        @commit-new="commitNewFolder"
        @cancel-new="creating = null"
      />

      <div
        v-for="f in tree.files"
        v-show="!q || f.name.toLowerCase().includes(q)"
        :key="f.id"
        class="wf-file"
        :title="`${f.name}\n${f.nodeCount} 个节点 · ${new Date(f.updated_at).toLocaleString()}`"
        @click="$emit('open-file', f.id)"
      >
        <FileJson :size="13" :stroke-width="1.8" />
        <span class="wf-name">{{ f.name }}</span>
        <span class="wf-meta">{{ f.nodeCount }} 节点</span>
        <button class="wf-x" title="删除" @click.stop="removeFile(f.id)">
          <Trash2 :size="12" :stroke-width="1.9" />
        </button>
      </div>

      <div v-if="loadError" class="wf-empty">
        <div>读取工作流目录失败</div>
        <div class="wf-empty-sub">{{ loadError }}</div>
        <button class="wf-retry" @click="refresh">重试</button>
      </div>
      <div v-else-if="totalFiles === 0" class="wf-empty">
        <div>这个目录里还没有工作流</div>
        <div class="wf-empty-sub">{{ rootHint }}</div>
      </div>
      <div v-else-if="q && !hasMatch" class="wf-empty">没有匹配的工作流</div>

      <div class="wf-divider">示例工作流</div>
      <div v-for="ex in EXAMPLES" :key="ex.file" class="wf-file" :title="ex.desc" @click="emit('open-example', ex)">
        <Sparkles :size="13" :stroke-width="1.8" />
        <span class="wf-name">{{ ex.name }}</span>
        <span class="wf-meta">{{ ex.desc }}</span>
      </div>
    </div>

    <!-- 统一弹窗：替代 window.confirm / alert / prompt -->
    <ConfirmDialog
      v-if="dlg"
      :title="dlg.title"
      :message="dlg.message"
      :mode="dlg.mode"
      :danger="dlg.danger"
      :default-value="dlg.defaultValue"
      :placeholder="dlg.placeholder"
      :confirm-text="dlg.confirmText"
      @confirm="onDlgConfirm"
      @close="dlg = null"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { FolderPlus, RefreshCw, ChevronLeft, Search, X, Upload, FileJson, Trash2, Sparkles } from 'lucide-vue-next'
import WorkflowFolderNode from './WorkflowFolderNode.vue'
import ConfirmDialog from '../dialogs/ConfirmDialog.vue'
import { useComfyStore, type WorkflowTreeNode } from '../../stores/comfyStore'

const emit = defineEmits<{
  (e: 'open-file', id: string): void
  (e: 'open-example', ex: { file: string; name: string }): void
  (e: 'toggle-panel'): void
  (e: 'import-file', file: File): void
}>()

const store = useComfyStore()
const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())
const tree = ref<WorkflowTreeNode>({ type: 'folder', name: '', path: '', folders: [], files: [] })
const expanded = ref<Set<string>>(new Set())
const creating = ref<string | null>(null)
const newFolderName = ref('')
const newFolderEl = ref<HTMLInputElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const loadError = ref('')

const rootHint = '把 .json 工作流拷进 user/workflows（可以带文件夹），或点上面「从本地文件打开」'

const EXAMPLES = [
  { file: '01-文本传递.json', name: '文本传递', desc: '文本输入 → 文本显示' },
  { file: '02-数值运算.json', name: '数值运算', desc: '两个数值 → 数学运算 → 显示' },
  { file: '03-图像预览.json', name: '图像预览', desc: '加载图像 → 预览（含尺寸）' },
  { file: '04-三链合一.json', name: '三链合一（推荐）', desc: '文本 + 数值 + 图像，点运行看结果' }
]

function countFiles(n: WorkflowTreeNode): number {
  return n.files.length + n.folders.reduce((s, f) => s + countFiles(f), 0)
}
const totalFiles = computed(() => countFiles(tree.value))
const hasMatch = computed(() => {
  const needle = q.value
  if (!needle) return true
  const walk = (n: WorkflowTreeNode): boolean =>
    n.files.some((f) => f.name.toLowerCase().includes(needle)) || n.folders.some(walk)
  return walk(tree.value)
})

/** 统一弹窗的请求描述（替代 window.confirm/alert/prompt） */
interface DlgReq {
  title: string
  message?: string
  mode: 'confirm' | 'alert' | 'prompt'
  danger?: boolean
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  onOk?: (value?: string) => void
}

const dlg = ref<DlgReq | null>(null)

/** 弹出确认框，返回 Promise<boolean>，用法接近 window.confirm */
function ask(req: Omit<DlgReq, 'mode'> & { mode?: 'confirm' | 'alert' | 'prompt' }): Promise<string | boolean> {
  return new Promise((resolve) => {
    dlg.value = {
      mode: 'confirm',
      ...req,
      onOk: (v) => resolve(v === undefined ? true : v)
    }
  })
}
function notifyError(msg: string): void {
  dlg.value = { title: '操作失败', message: msg, mode: 'alert', confirmText: '知道了' }
}
function onDlgConfirm(value?: string): void {
  dlg.value?.onOk?.(value)
  dlg.value = null
}

async function refresh(): Promise<void> {
  try {
    tree.value = await store.loadWorkflowTree()
    loadError.value = ''
  } catch (e) {
    tree.value = { type: 'folder', name: '', path: '', folders: [], files: [] }
    loadError.value = (e as Error).message || '读取失败'
  }
}

function toggle(path: string): void {
  if (expanded.value.has(path)) expanded.value.delete(path)
  else expanded.value.add(path)
}

async function startNewFolder(parent: string): Promise<void> {
  creating.value = parent || '__root__'
  newFolderName.value = ''
  if (parent) expanded.value.add(parent)
  await nextTick()
  newFolderEl.value?.focus()
}

async function commitNewFolder(parent: string, name?: string): Promise<void> {
  // 子文件夹：由 WorkflowFolderNode 直接带名字上来；根文件夹走 commitRootFolder
  const folder = parent || ''
  const folderName = (name ?? '').trim()
  creating.value = null
  if (!folderName) return
  const r = await store.createWorkflowFolder(folder, folderName)
  if (!r.ok) {
    notifyError(`新建文件夹失败：${r.error}`)
    return
  }
  expanded.value.add(folder ? `${folder}/${folderName}` : folderName)
  await refresh()
}

async function commitRootFolder(): Promise<void> {
  if (creating.value !== '__root__') return
  const name = newFolderName.value.trim()
  creating.value = null
  newFolderName.value = ''
  if (!name) return
  const r = await store.createWorkflowFolder('', name)
  if (!r.ok) {
    notifyError(`新建文件夹失败：${r.error}`)
    return
  }
  expanded.value.add(name)
  await refresh()
}

async function renameFolder(path: string): Promise<void> {
  const name = await ask({
    title: '重命名文件夹',
    message: `把「${path.split('/').pop() || ''}」改名为：`,
    mode: 'prompt',
    defaultValue: path.split('/').pop() || '',
    placeholder: '新名称'
  })
  if (typeof name !== 'string' || !name.trim()) return
  const r = await store.renameWorkflowFolder(path, name.trim())
  if (!r.ok) notifyError(`重命名失败：${r.error}`)
  await refresh()
}

async function removeFolder(path: string): Promise<void> {
  const node = findFolder(tree.value, path)
  const n = node ? countFiles(node) : 0
  const ok = await ask({
    title: '删除文件夹',
    message: `确定删除「${path}」？${n ? `\n里面有 ${n} 个工作流，会一并删除，且无法恢复。` : ''}`,
    danger: true,
    confirmText: '删除'
  })
  if (ok !== true) return
  await store.deleteWorkflowFolder(path)
  await refresh()
}

async function removeFile(id: string): Promise<void> {
  const ok = await ask({
    title: '删除工作流',
    message: `确定删除「${id}」？\n删除后文件从 user/workflows 移除，无法恢复。`,
    danger: true,
    confirmText: '删除'
  })
  if (ok !== true) return
  await store.deleteWorkflow(id)
  await refresh()
}

function findFolder(n: WorkflowTreeNode, path: string): WorkflowTreeNode | null {
  if (n.path === path) return n
  for (const c of n.folders) {
    const hit = findFolder(c, path)
    if (hit) return hit
  }
  return null
}

function pickLocalFile(): void {
  fileEl.value?.click()
}
function onFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import-file', file)
}

onMounted(async () => {
  await refresh()
  // 默认展开一级目录
  for (const f of tree.value.folders) expanded.value.add(f.path)
})
</script>

<style scoped>
.wf-panel {
  /* 浮在画布上（和 AI 助手同一套做法），不再挤压画布 */
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 52px;
  width: 268px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: #17191d;
  border: 1px solid #2c313a;
  border-radius: 9px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  z-index: 50;
  overflow: hidden;
}
.wf-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 8px 6px 12px;
}
.wf-title { font-size: 12.5px; font-weight: 600; color: #e6ecf4; letter-spacing: 0.3px; }
.wf-count {
  font-size: 10.5px;
  color: #7d8794;
  background: #23272e;
  border-radius: 9px;
  padding: 1px 6px;
}
.wf-head-actions { margin-left: auto; display: flex; align-items: center; gap: 1px; }
.wf-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #8b95a3;
  cursor: pointer;
}
.wf-icon:hover { background: #2e343d; color: #fff; }

.wf-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 10px 6px;
  padding: 0 8px;
  height: 28px;
  background: #1e2128;
  border: 1px solid #2d323a;
  border-radius: 7px;
  color: #7d8794;
}
.wf-search:focus-within { border-color: #3b6ea8; }
.wf-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: #dfe6ee;
  font-size: 12.5px;
}
.wf-clear { background: transparent; border: 0; color: #7d8794; cursor: pointer; padding: 0; display: inline-flex; }
.wf-clear:hover { color: #fff; }

.wf-import {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0 10px 8px;
  height: 28px;
  background: #1e2128;
  border: 1px solid #2d323a;
  border-radius: 7px;
  color: #b7c1cd;
  font-size: 12px;
  cursor: pointer;
}
.wf-import:hover { border-color: #3b6ea8; color: #fff; }

.wf-body { flex: 1; overflow-y: auto; padding: 0 8px 10px; }

.wf-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12.5px;
  color: #c8d1dc;
}
.wf-file:hover { background: #232a33; color: #fff; }
.wf-file svg { color: #7d8794; flex: none; }
.wf-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: 0;
  padding: 0;
  width: auto;
  border-radius: 0;
}
.wf-meta { font-size: 10.5px; color: #6d7683; flex: none; }
.wf-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #7d8794;
  cursor: pointer;
  padding: 0;
  flex: none;
  opacity: 0;
}
.wf-file:hover .wf-x { opacity: 1; }
.wf-x:hover { background: #3a2222; color: #ff8e8e; }

.wf-newrow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  color: #8b95a3;
}
.wf-newinput {
  flex: 1;
  min-width: 0;
  height: 22px;
  background: #0f1216;
  border: 1px solid #2a6fd4;
  border-radius: 5px;
  color: #e6ecf4;
  font-size: 12px;
  padding: 0 6px;
  outline: none;
}

.wf-empty { color: #6d7683; font-size: 12px; padding: 18px 10px; text-align: center; line-height: 1.7; }
.wf-empty-sub { font-size: 11px; color: #565f6c; }
.wf-retry {
  margin-top: 8px;
  background: #22262d;
  border: 1px solid #333941;
  color: #cfd8e3;
  font-size: 11.5px;
  padding: 4px 12px;
  border-radius: 5px;
  cursor: pointer;
}
.wf-retry:hover { background: #2a2f37; color: #fff; }

.wf-divider {
  font-size: 10.5px;
  color: #5c6572;
  letter-spacing: 0.5px;
  padding: 10px 8px 4px;
  border-top: 1px solid #23272e;
  margin-top: 8px;
}
</style>
