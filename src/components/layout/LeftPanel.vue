<template>
  <aside class="left-panel">
    <div class="lp-head">
      <span class="lp-title">节点库</span>
      <span class="lp-count">{{ filtered.length }}</span>
      <IconBtn :icon="ChevronLeft" tip="收起面板" tip-pos="right" :size="15" @click="$emit('toggle-panel')" />
    </div>

    <div class="lp-search">
      <Search :size="13" :stroke-width="2" />
      <input v-model="query" placeholder="搜索节点…" spellcheck="false" />
      <button v-if="query" class="lp-clear" title="清空" @click="query = ''">
        <X :size="12" />
      </button>
    </div>

    <label class="lp-filter" title="同时作用于画布右键的「搜索节点」：关掉后才会出现本机没装插件的节点">
      <input type="checkbox" v-model="store.onlyNative" />
      <span>只显示本机可运行的节点</span>
    </label>

    <div class="lp-body">
      <div v-for="cat in categories" :key="cat.category" class="node-cat">
        <div class="node-cat-header" @click="toggleCat(cat.category)">
          <ChevronRight :size="13" class="arrow" :class="{ open: expanded.has(cat.category) }" />
          <span class="cat-name">{{ cat.category }}</span>
          <span class="cat-count">{{ cat.nodes.length }}</span>
        </div>
        <div v-if="expanded.has(cat.category)" class="node-cat-children">
          <div
            v-for="n in cat.nodes"
            :key="n.name"
            class="node-item"
            draggable="true"
            :title="`${n.display_name}\n${n.name}\n点击添加到视图中心，或拖到画布任意位置`"
            @click="$emit('add-node', n.name)"
            @dragstart="onDragStart($event, n.name)"
            @dragend="onDragEnd"
          >
            <span class="ni-name">{{ n.display_name }}</span>
            <span v-if="n.native" class="native-badge">本地</span>
          </div>
        </div>
      </div>
      <div v-if="!categories.length" class="lp-empty">没有匹配的节点</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-vue-next'
import IconBtn from '../ui/IconBtn.vue'
import { useComfyStore } from '../../stores/comfyStore'

defineEmits<{
  (e: 'add-node', type: string): void
  (e: 'toggle-panel'): void
}>()

const store = useComfyStore()
const query = ref('')
const expanded = ref<Set<string>>(new Set(['utils/text', 'utils/primitive', 'utils/math', 'image', 'llm']))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out: Array<{ name: string; display_name: string; native: boolean; category: string }> = []
  for (const def of store.visibleNodeDefs) {
    if (q && !`${def.name} ${def.display_name}`.toLowerCase().includes(q)) continue
    out.push({ name: def.name, display_name: def.display_name || def.name, native: !!def.native, category: def.category || 'sd' })
  }
  return out
})

const categories = computed(() => {
  const map = new Map<string, Array<{ name: string; display_name: string; native: boolean }>>()
  for (const n of filtered.value) {
    if (!map.has(n.category)) map.set(n.category, [])
    map.get(n.category)!.push({ name: n.name, display_name: n.display_name, native: n.native })
  }
  return [...map.entries()]
    .map(([category, nodes]) => ({ category, nodes: nodes.sort((a, b) => a.display_name.localeCompare(b.display_name)) }))
    .sort((a, b) => a.category.localeCompare(b.category))
})

/** 搜索时自动展开命中的分类 */
function toggleCat(cat: string): void {
  if (expanded.value.has(cat)) expanded.value.delete(cat)
  else expanded.value.add(cat)
}

function onDragStart(e: DragEvent, type: string): void {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/comfy-node-type', type)
  e.dataTransfer.effectAllowed = 'copy'
}
function onDragEnd(): void {
  document.querySelector('.canvas-host')?.classList.remove('drop-active')
}
</script>

<style scoped>
.left-panel {
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
.lp-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 8px 6px 12px;
}
.lp-title { font-size: 12.5px; font-weight: 600; color: #e6ecf4; letter-spacing: 0.3px; }
.lp-count {
  font-size: 10.5px;
  color: #7d8794;
  background: #23272e;
  border-radius: 9px;
  padding: 1px 6px;
}
.lp-head .icon-btn { margin-left: auto; }

.lp-search {
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
.lp-search:focus-within { border-color: #3b6ea8; }
.lp-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: #dfe6ee;
  font-size: 12.5px;
}
.lp-clear { background: transparent; border: 0; color: #7d8794; cursor: pointer; padding: 0; display: inline-flex; }
.lp-clear:hover { color: #fff; }

.lp-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  font-size: 11.5px;
  color: #8b95a3;
  cursor: pointer;
  user-select: none;
}
.lp-filter input { accent-color: #1a5fb4; }

.lp-body { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
.lp-empty { color: #6d7683; font-size: 12px; padding: 16px 8px; text-align: center; }

.node-cat { margin-bottom: 1px; }
.node-cat-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4.5px 6px;
  border-radius: 5px;
  cursor: pointer;
  color: #a9b3c0;
  font-size: 12px;
  user-select: none;
}
.node-cat-header:hover { background: #23272e; color: #e6ecf4; }
.arrow { transition: transform 0.14s ease; flex: none; }
.arrow.open { transform: rotate(90deg); }
.cat-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-count { font-size: 10.5px; color: #6d7683; }
.node-cat-children { padding-left: 10px; }

.node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: grab;
  font-size: 12.5px;
  color: #c8d1dc;
}
.node-item:hover { background: #232a33; color: #fff; }
.node-item:active { cursor: grabbing; }
.ni-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.native-badge {
  font-size: 9.5px;
  color: #7ee0a3;
  border: 1px solid #2c5b3f;
  border-radius: 4px;
  padding: 0 4px;
  flex: none;
}
</style>
