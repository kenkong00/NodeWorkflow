<template>
  <header class="topbar">
    <!-- Logo（去掉文字标题，只留标记） -->
    <div class="brand" title="节点编辑工作流">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="2.5" y="2.5" width="8" height="8" rx="2.2" stroke="#7ab0ff" stroke-width="1.7" />
        <rect x="13.5" y="13.5" width="8" height="8" rx="2.2" stroke="#7ab0ff" stroke-width="1.7" />
        <path d="M10.5 6.5h4.2A2.3 2.3 0 0 1 17 8.8v4.2" stroke="#7ab0ff" stroke-width="1.7" stroke-linecap="round" />
        <circle cx="6.5" cy="6.5" r="1.1" fill="#7ab0ff" />
        <circle cx="17.5" cy="17.5" r="1.1" fill="#7ab0ff" />
      </svg>
    </div>

    <!-- 多工作流选项卡 -->
    <div class="tabs" ref="tabsEl">
      <div
        v-for="t in tabs.tabs"
        :key="t.id"
        class="tab"
        :class="{ active: t.id === tabs.activeId, dirty: t.dirty }"
        :title="`${t.name}（双击重命名）`"
        @click="$emit('select-tab', t.id)"
        @mousedown.middle.prevent="$emit('close-tab', t.id)"
        @dblclick.stop="startRename(t)"
      >
        <input
          v-if="renamingId === t.id"
          ref="renameInputEl"
          v-model="renameDraft"
          class="tab-rename"
          maxlength="60"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <template v-else>
          <span class="tab-name">{{ t.name }}</span>
          <span class="tab-dot" v-if="t.dirty"></span>
        </template>
        <button class="tab-x" title="关闭" @click.stop="$emit('close-tab', t.id)">
          <X :size="12" :stroke-width="2.2" />
        </button>
      </div>
      <IconBtn :icon="Plus" tip="新建工作流" tip-pos="bottom" @click="$emit('new')" />
    </div>

    <div class="tb-spacer"></div>

    <!-- 运行 / 停止 -->
    <div class="run-group">
      <IconBtn
        class="run-btn"
        :icon="Play"
        wide
        primary
        tip="运行工作流"
        :pulse="running"
        :badge="taskCount"
        @click="$emit('run')"
      />
      <div class="stop-wrap" ref="stopEl">
        <IconBtn
          :icon="Square"
          :tip="running ? '停止 / 取消任务' : '没有正在运行的任务'"
          danger
          :disabled="!running"
          @click="onStopClick"
        />
        <div v-if="stopMenu" class="task-menu">
          <div class="tm-head">
            <span>任务队列</span>
            <button class="tm-clear" @click="cancelAll">全部停止</button>
          </div>
          <div v-if="!tasks.length" class="tm-empty">暂无任务</div>
          <div v-for="t in tasks" :key="t.prompt_id" class="tm-row">
            <span class="tm-dot" :class="{ live: t.live }"></span>
            <span class="tm-name">{{ t.title || '未命名工作流' }}</span>
            <span class="tm-no">#{{ t.number }}</span>
            <button class="tm-x" title="取消该任务" @click="cancel(t.prompt_id)">
              <X :size="12" />
            </button>
          </div>
        </div>
      </div>

      <!-- AI 助手（悬浮在画布右侧的对话窗口） -->
      <button
        class="ai-btn tip-bottom"
        :class="{ on: aiOpen }"
        :data-tip="aiOpen ? '收起 AI 助手' : 'AI 助手'"
        type="button"
        @click="$emit('toggle-ai')"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          <path d="M18 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Play, Square, Plus, X } from 'lucide-vue-next'
import IconBtn from '../ui/IconBtn.vue'
import { useComfyStore } from '../../stores/comfyStore'
import { useTabsStore } from '../../stores/useTabsStore'
import type { WorkflowTab } from '../../stores/useTabsStore'

defineProps<{ aiOpen: boolean }>()

const emit = defineEmits<{
  (e: 'select-tab', id: string): void
  (e: 'close-tab', id: string): void
  (e: 'new'): void
  (e: 'run'): void
  (e: 'rename-tab', payload: { id: string; name: string }): void
  (e: 'toggle-ai'): void
}>()

const store = useComfyStore()
const tabs = useTabsStore()

const stopMenu = ref(false)
const stopEl = ref<HTMLElement>()
const tabsEl = ref<HTMLElement>()

// ---- 标签重命名（双击） ----
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renameInputEl = ref<HTMLInputElement | HTMLInputElement[]>()

async function startRename(t: WorkflowTab): Promise<void> {
  renamingId.value = t.id
  renameDraft.value = t.name
  await nextTick()
  const el = Array.isArray(renameInputEl.value) ? renameInputEl.value[0] : renameInputEl.value
  el?.focus()
  el?.select()
}

function commitRename(): void {
  const id = renamingId.value
  if (!id) return
  const name = renameDraft.value.trim()
  renamingId.value = null
  if (!name) return
  emit('rename-tab', { id, name })
}

function cancelRename(): void {
  renamingId.value = null
}

const running = computed(() => !!store.exec.running || store.exec.status === 'running')
const taskCount = computed(() => (store.exec.running ? 1 : 0) + store.exec.pending.length)
const tasks = computed(() => {
  const list = []
  if (store.exec.running) list.push({ ...store.exec.running, live: true })
  for (const p of store.exec.pending) list.push({ ...p, live: false })
  return list
})

function onStopClick(): void {
  // 只有一个任务 → 直接停；多个任务 → 展开下拉逐个取消
  if (taskCount.value <= 1) {
    void store.interrupt()
    stopMenu.value = false
    return
  }
  stopMenu.value = !stopMenu.value
}

async function cancel(promptId: string): Promise<void> {
  await store.cancelTask(promptId)
  if (taskCount.value === 0) stopMenu.value = false
}

async function cancelAll(): Promise<void> {
  await store.interrupt()
  stopMenu.value = false
}

function onDocClick(e: MouseEvent): void {
  if (!stopMenu.value) return
  if (stopEl.value && !stopEl.value.contains(e.target as Node)) stopMenu.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocClick))
void tabsEl
</script>

<style scoped>
.topbar {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  background: #171718;
  border-bottom: 1px solid #2c2f35;
  z-index: 30;
}
.brand { display: flex; align-items: center; padding-right: 4px; }
.brand svg { display: block; }

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 58vw;
  scrollbar-width: none;
  padding: 2px 0;
}
.tabs::-webkit-scrollbar { height: 0; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 6px 0 10px;
  border-radius: 6px;
  background: #212429;
  border: 1px solid #2b2f36;
  color: #9aa4b2;
  font-size: 12.5px;
  cursor: pointer;
  max-width: 190px;
  flex: none;
  user-select: none;
}
.tab:hover { background: #282c33; color: #d7dee8; }
.tab.active { background: #2f3944; border-color: #3d4a59; color: #fff; }
.tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-rename {
  width: 128px;
  min-width: 80px;
  background: #0f1216;
  border: 1px solid #2a6fd4;
  border-radius: 4px;
  color: #fff;
  font-size: 12.5px;
  font-family: inherit;
  padding: 2px 5px;
  outline: none;
}
.tab-dot { width: 5px; height: 5px; border-radius: 50%; background: #e8a33d; flex: none; }
.tab-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px; height: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #7c8794;
  cursor: pointer;
  opacity: 0;
}
.tab:hover .tab-x, .tab.active .tab-x { opacity: 1; }
.tab-x:hover { background: #4a2b2b; color: #ff9b9b; }

.tb-spacer { flex: 1; }

.run-group { display: flex; align-items: center; gap: 6px; }
.run-btn { height: 30px; }
.stop-wrap { position: relative; }

/* AI 助手入口：与 IconBtn 同一视觉尺寸，颜色偏蓝以示「智能」 */
.ai-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #9dbbe0;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.ai-btn:hover { background: #2e343d; color: #cfe1f8; }
.ai-btn.on { background: rgba(26, 95, 180, 0.22); border-color: #2a5fa5; color: #9dc6f7; }

.task-menu {
  position: absolute;
  right: 0;
  top: 36px;
  width: 260px;
  background: #12151a;
  border: 1px solid #333c48;
  border-radius: 9px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
  padding: 6px;
  z-index: 80;
}
.tm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #8b95a3;
  padding: 3px 6px 7px;
  border-bottom: 1px solid #232a33;
  margin-bottom: 4px;
  letter-spacing: 0.4px;
}
.tm-clear {
  background: transparent;
  border: 0;
  color: #ff9b9b;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.tm-clear:hover { background: #3a2222; }
.tm-empty { color: #6d7683; font-size: 12px; padding: 12px 8px; text-align: center; }
.tm-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 6px;
  border-radius: 6px;
  font-size: 12.5px;
  color: #cfd6e0;
}
.tm-row:hover { background: #1d222a; }
.tm-dot { width: 6px; height: 6px; border-radius: 50%; background: #5b6472; flex: none; }
.tm-dot.live { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.tm-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-no { font-size: 10.5px; color: #6d7683; }
.tm-x {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; border-radius: 4px;
  color: #7c8794; cursor: pointer; padding: 0;
}
.tm-x:hover { background: #4a2b2b; color: #ff9b9b; }
</style>
