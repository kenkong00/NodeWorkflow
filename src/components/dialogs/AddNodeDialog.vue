<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        添加节点
        <button class="x" type="button" title="关闭" @click="$emit('close')">
          <X :size="14" :stroke-width="2.2" />
        </button>
      </div>
      <div class="modal-body">
        <input
          ref="searchEl"
          class="add-node-search"
          v-model="query"
          placeholder="搜索节点（输入名称或类型）…"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="confirm()"
        />
        <div class="add-node-list">
          <template v-if="!query">
            <div v-for="cat in store.categoryTree" :key="cat.category" class="node-cat">
              <div class="node-cat-header" @click="toggleCat(cat.category)">
                <span class="arrow" :class="{ open: expanded.has(cat.category) }">▶</span>
                {{ cat.category }}
                <span style="margin-left:auto;font-size:11px;color:#888">{{ cat.nodes.length }}</span>
              </div>
              <div v-if="expanded.has(cat.category)" class="node-cat-children">
                <div
                  v-for="n in cat.nodes"
                  :key="n.name"
                  class="node-item"
                  @dblclick="pick(n.name)"
                  @click="sel = n.name"
                  :class="{ sel: sel === n.name }"
                >
                  <span class="dot" :style="{ background: colorFor(n.name) }"></span>
                  {{ n.display_name }}
                  <span v-if="n.native" class="native-badge">原生</span>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div
              v-for="n in filtered"
              :key="n.name"
              class="add-node-row"
              :class="{ sel: sel === n.name }"
              @click="pick(n.name)"
            >
              <span class="dot" :style="{ background: colorFor(n.name) }"></span>
              <span class="nm">{{ n.display_name }}</span>
              <span class="cat">{{ n.name }}</span>
            </div>
            <div v-if="!filtered.length" style="padding:18px;text-align:center;color:#888">没有匹配的节点</div>
          </template>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!sel" @click="confirm()">添加</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useComfyStore } from '../../stores/comfyStore'
import { ComfyGraph } from '../../engine/ComfyGraph'

defineProps<{ pos: [number, number] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'add', type: string): void }>()

const store = useComfyStore()
const query = ref('')
const sel = ref<string>('')
const searchEl = ref<HTMLInputElement>()
const expanded = ref<Set<string>>(new Set(['utils/text', 'llm', 'image', 'utils/primitive', 'utils/math']))

onMounted(async () => {
  if (!store.registryLoaded) await store.loadRegistry()
  await nextTick()
  searchEl.value?.focus()
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = Object.values(store.nodeDefs)
  if (!q) return []
  return all
    .filter((d) => (d.display_name || d.name).toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
    .slice(0, 60)
    .map((d) => ({ name: d.name, display_name: d.display_name || d.name, native: !!d.native }))
})

function colorFor(name: string): string {
  const def = store.nodeDefs[name]
  if (!def) return '#9A9'
  const out = def.output?.[0]
  return ComfyGraph.colorFor(out || '*')
}

function toggleCat(cat: string): void {
  if (expanded.value.has(cat)) expanded.value.delete(cat)
  else expanded.value.add(cat)
}

function move(delta: number): void {
  const list = query.value ? filtered.value : []
  if (!list.length) return
  const idx = list.findIndex((n) => n.name === sel.value)
  const next = Math.max(0, Math.min(list.length - 1, idx + delta))
  sel.value = list[next].name
}

function pick(name: string): void {
  emit('add', name)
}

function confirm(): void {
  if (sel.value) emit('add', sel.value)
}
</script>
