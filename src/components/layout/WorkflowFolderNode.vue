<template>
  <div class="wf-node">
    <div
      class="wf-folder"
      :class="{ open: isOpen }"
      :style="{ paddingLeft: 6 + depth * 12 + 'px' }"
      @click="$emit('toggle', node.path)"
    >
      <ChevronRight :size="12" :stroke-width="2" class="wf-arrow" :class="{ open: isOpen }" />
      <Folder :size="13" :stroke-width="1.8" class="wf-folder-icon" />
      <span class="wf-folder-name">{{ node.name }}</span>
      <span class="wf-folder-count">{{ count }}</span>
      <div class="wf-folder-actions">
        <button class="wf-fa" title="在此新建文件夹" @click.stop="$emit('new-folder', node.path)">
          <FolderPlus :size="14" :stroke-width="1.9" />
        </button>
        <button class="wf-fa" title="重命名" @click.stop="$emit('rename', node.path)">
          <Pencil :size="14" :stroke-width="1.9" />
        </button>
        <button class="wf-fa danger" title="删除文件夹" @click.stop="$emit('delete', node.path)">
          <Trash2 :size="14" :stroke-width="1.9" />
        </button>
      </div>
    </div>

    <div v-show="isOpen" class="wf-children">
      <!-- 正在该文件夹下新建 -->
      <div v-if="creating === node.path" class="wf-newrow" :style="{ paddingLeft: 14 + (depth + 1) * 12 + 'px' }">
        <FolderPlus :size="12" />
        <input
          ref="inputEl"
          v-model="draft"
          class="wf-newinput"
          placeholder="文件夹名称"
          @keydown.enter.prevent="commit"
          @keydown.esc.prevent="$emit('cancel-new')"
          @blur="commit"
        />
      </div>

      <WorkflowFolderNode
        v-for="c in node.folders"
        :key="c.path"
        :node="c"
        :depth="depth + 1"
        :expanded="expanded"
        :query="query"
        :creating="creating"
        @toggle="(p) => $emit('toggle', p)"
        @open="(id) => $emit('open', id)"
        @new-folder="(p) => $emit('new-folder', p)"
        @rename="(p) => $emit('rename', p)"
        @delete="(p) => $emit('delete', p)"
        @delete-file="(id) => $emit('delete-file', id)"
        @commit-new="(p, n) => $emit('commit-new', p, n)"
        @cancel-new="$emit('cancel-new')"
      />

      <div
        v-for="f in node.files"
        v-show="!query || f.name.toLowerCase().includes(query)"
        :key="f.id"
        class="wf-file"
        :style="{ paddingLeft: 14 + (depth + 1) * 12 + 'px' }"
        :title="`${f.name}\n${f.nodeCount} 个节点 · ${new Date(f.updated_at).toLocaleString()}`"
        @click="$emit('open', f.id)"
      >
        <FileJson :size="13" :stroke-width="1.8" />
        <span class="wf-name">{{ f.name }}</span>
        <span class="wf-meta">{{ f.nodeCount }}</span>
        <button class="wf-x" title="删除" @click.stop="$emit('delete-file', f.id)">
          <Trash2 :size="12" :stroke-width="1.9" />
        </button>
      </div>

      <div v-if="!node.folders.length && !node.files.length" class="wf-folder-empty" :style="{ paddingLeft: 14 + (depth + 1) * 12 + 'px' }">
        空文件夹
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, Folder, FolderPlus, Pencil, Trash2, FileJson } from 'lucide-vue-next'
import type { WorkflowTreeNode } from '../../stores/comfyStore'

const props = defineProps<{
  node: WorkflowTreeNode
  depth: number
  expanded: Set<string>
  query: string
  creating: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle', path: string): void
  (e: 'open', id: string): void
  (e: 'new-folder', parent: string): void
  (e: 'rename', path: string): void
  (e: 'delete', path: string): void
  (e: 'delete-file', id: string): void
  (e: 'commit-new', parent: string, name: string): void
  (e: 'cancel-new'): void
}>()

const isOpen = computed(() => props.expanded.has(props.node.path))

function countAll(n: WorkflowTreeNode): number {
  return n.files.length + n.folders.reduce((s, f) => s + countAll(f), 0)
}
const count = computed(() => countAll(props.node))

const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
watch(
  () => props.creating,
  (v) => {
    if (v === props.node.path) {
      draft.value = ''
      nextTick(() => inputEl.value?.focus())
    }
  }
)

function commit(): void {
  if (props.creating !== props.node.path) return
  const name = draft.value.trim()
  draft.value = ''
  if (!name) {
    emit('cancel-new')
    return
  }
  emit('commit-new', props.node.path, name)
}
</script>

<style scoped>
.wf-folder {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  color: #a9b3c0;
  font-size: 12px;
  user-select: none;
}
.wf-folder:hover { background: #23272e; color: #e6ecf4; }
.wf-arrow { transition: transform 0.14s ease; flex: none; }
.wf-arrow.open { transform: rotate(90deg); }
.wf-folder-icon { color: #7d8794; flex: none; }
.wf-folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-folder-count { font-size: 10.5px; color: #6d7683; flex: none; }
.wf-folder-actions { display: flex; gap: 1px; flex: none; opacity: 0; }
.wf-folder:hover .wf-folder-actions { opacity: 1; }
.wf-fa {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8b95a3;
  cursor: pointer;
  padding: 0;
}
.wf-fa:hover { background: #333a44; color: #fff; }
.wf-fa.danger:hover { background: #3a2222; color: #ff8e8e; }

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

.wf-folder-empty { font-size: 11px; color: #565f6c; padding: 3px 8px; }
.wf-newrow { display: flex; align-items: center; gap: 6px; padding: 3px 8px; color: #8b95a3; }
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
</style>
