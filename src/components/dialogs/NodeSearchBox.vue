<template>
  <!--
    ComfyUI 同款节点搜索浮层（复刻 litegraph fork showSearchBox）：
    - 定位：跟随鼠标 (clientX-80, clientY-20)，靠近视口底部时列表限高
    - 匹配：输入小写包含匹配 name / display_name / category 路径；多词按序全部包含
    - 类型过滤：filterInType（从输出端口拖出→找有此输入的节点）/ filterOutType（从输入端口拖出→找有此输出的节点）
      过滤无结果 → 展示全部通用节点兜底；有结果 → 通用节点追加在后
    - 键盘：↑↓ 移动 / Enter 放置 / Esc 关闭；点击条目直接放置
  -->
  <div class="node-search-mask" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
    <div class="node-search-box" :style="boxStyle">
      <div class="nsb-head">
        <span class="nsb-title">搜索节点</span>
        <span v-if="filterLabel" class="nsb-filter" :title="'只显示可连接 ' + filterLabel + ' 的节点'">
          <Zap :size="11" :stroke-width="2.2" />
          {{ filterLabel }}
        </span>
        <span class="nsb-meta">
          <span v-if="store.onlyNative" class="nsb-native-tag" title="左侧节点库的「只显示本机可运行的节点」已开启，本机跑不了的节点不在此列出">仅本机可运行</span>
          <span class="nsb-count">{{ filtered.length }}</span>
        </span>
      </div>
      <input
        ref="inputEl"
        v-model="query"
        class="nsb-input"
        type="text"
        placeholder="输入节点名称…（↑↓ 选择，Enter 放置）"
        autocomplete="off"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="confirm()"
        @keydown.esc.prevent="$emit('close')"
      />
      <div ref="listEl" class="nsb-list">
        <div
          v-for="(n, i) in filtered"
          :key="n.name"
          class="nsb-row"
          :class="{ sel: i === selIdx, generic: n.generic }"
          @click="pick(n.name)"
          @mouseenter="selIdx = i"
        >
          <span class="nm">{{ n.display_name }}</span>
          <span class="cat">{{ n.name }}</span>
          <span v-if="n.native" class="native-badge" title="本机原生节点，可直接执行">本地</span>
          <span v-if="n.generic" class="generic-badge" title="类型不完全匹配，但可能可连（通用端口）">通用</span>
        </div>
        <div v-if="!filtered.length" class="nsb-empty">
          <template v-if="hiddenCount">没有匹配的可运行节点<span class="nsb-hidden">（已隐藏 {{ hiddenCount }} 个本机无法运行的节点）</span>
            <button class="nsb-showall" @click="store.onlyNative = false">显示全部节点</button>
          </template>
          <template v-else>没有匹配的节点</template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Zap } from 'lucide-vue-next'
import { useComfyStore } from '../../stores/comfyStore'

export interface SearchFilter {
  /** 鼠标 clientX/clientY（屏幕坐标） */
  clientX: number
  clientY: number
  /** 画布坐标（节点落点） */
  canvasX: number
  canvasY: number
  /** 从哪个节点的哪个端口拖出 */
  fromNodeId?: number
  fromSlot?: number
  fromType?: string
  /** true=从输出端口拖出（找有此输入的节点） false=从输入端口拖出（找有此输出的节点） */
  fromOutput?: boolean
}

const props = defineProps<{ filter: SearchFilter }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'add', type: string, filter: SearchFilter): void }>()

const store = useComfyStore()
const query = ref('')
const selIdx = ref(0)
const inputEl = ref<HTMLInputElement>()
const listEl = ref<HTMLDivElement>()

onMounted(async () => {
  if (!store.registryLoaded) await store.loadRegistry()
  await nextTick()
  inputEl.value?.focus()
})

/** 类型兼容判断（与 litegraph isValidConnection 同规则：通配/精确小写/逗号排列） */
function typeOk(a: string, b: string): boolean {
  const norm = (t: string) => (t === '' || t === '*' ? '' : String(t).toLowerCase())
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb || na === nb) return true
  if (na.includes(',')) return na.split(',').some(x => typeOk(x, b))
  if (nb.includes(',')) return nb.split(',').some(y => typeOk(a, y))
  return false
}

interface Row { name: string; display_name: string; native: boolean; generic: boolean }

/** 会成为「端口」的输入（与 nodeFactory 建端口规则一致）：
 *  forceInput 强制端口；控件类（INT/FLOAT/STRING/BOOLEAN/COLOR/IMAGEUPLOAD/COMBO 下拉）不成端口 */
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COLOR', 'IMAGEUPLOAD'])
function isPortInput(spec: unknown): boolean {
  const raw = spec as [unknown, Record<string, unknown>?]
  const t = raw[0]
  const cfg = raw[1] || {}
  if (Array.isArray(t)) return false // COMBO 下拉 = 控件
  if (cfg.forceInput) return true
  return !WIDGET_TYPES.has(String(t))
}

/** 被「只显示本机可运行」开关隐藏掉的节点数（用于给用户一个可回退的提示） */
const hiddenCount = computed(() =>
  store.onlyNative ? Object.keys(store.nodeDefs).length - store.visibleNodeDefs.length : 0
)

const filtered = computed<Row[]>(() => {
  // 与左侧节点库共用 store.onlyNative：本机跑不起来的节点在右键搜索里也不出现
  const all = store.visibleNodeDefs
  const q = query.value.trim().toLowerCase()
  const words = q ? q.split(/\s+/).filter(Boolean) : []
  const matchText = (def: (typeof all)[number]): boolean => {
    if (!words.length) return true
    const hay = `${def.name} ${def.display_name || def.name} ${def.category || ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  }
  // 端口类型匹配：def 是否存在与过滤类型兼容的输入/输出端口
  const hasInputOf = (def: (typeof all)[number], t: string): boolean => {
    for (const grp of ['required', 'optional'] as const) {
      for (const spec of Object.values(def.input[grp] || {})) {
        if (!isPortInput(spec)) continue
        if (typeOk(String((spec as unknown as [unknown])[0]), t)) return true
      }
    }
    return false
  }
  const hasOutputOf = (def: (typeof all)[number], t: string): boolean =>
    (def.output || []).some(o => typeOk(String(o), t))

  const rows: Row[] = []
  if (props.filter.fromType) {
    const strict: Row[] = []
    const loose: Row[] = []
    for (const def of all) {
      if (!matchText(def)) continue
      const ok = props.filter.fromOutput ? hasInputOf(def, props.filter.fromType) : hasOutputOf(def, props.filter.fromType)
      const row: Row = { name: def.name, display_name: def.display_name || def.name, native: !!def.native, generic: false }
      if (ok) strict.push(row)
      else if (def.name === 'Reroute' || def.name === 'PrimitiveNode') loose.push({ ...row, generic: true })
    }
    // 原生节点优先（本机可真实执行），其余按名称
    strict.sort((a, b) => (b.native ? 1 : 0) - (a.native ? 1 : 0) || a.display_name.localeCompare(b.display_name))
    rows.push(...strict, ...loose)
    if (!rows.length) {
      // 类型过滤无结果 → 全部兜底（ComfyUI show_general_if_none_on_typefilter）
      for (const def of all) if (matchText(def)) rows.push({ name: def.name, display_name: def.display_name || def.name, native: !!def.native, generic: true })
    }
  } else {
    for (const def of all) if (matchText(def)) rows.push({ name: def.name, display_name: def.display_name || def.name, native: !!def.native, generic: false })
  }
  return rows.slice(0, 80)
})

const filterLabel = computed(() => {
  if (!props.filter.fromType) return ''
  return `${props.filter.fromOutput ? '输入' : '输出'} ${props.filter.fromType}`
})

/** ComfyUI 定位：left = clientX - 80, top = clientY - 20；靠近底部限高 */
const boxStyle = computed(() => {
  const vh = window.innerHeight
  const nearBottom = props.filter.clientY > vh - 320
  return {
    left: `${Math.max(8, props.filter.clientX - 80)}px`,
    top: nearBottom ? '' : `${Math.max(8, props.filter.clientY - 20)}px`,
    bottom: nearBottom ? `${Math.max(8, vh - props.filter.clientY + 20)}px` : ''
  }
})

function move(delta: number): void {
  const n = filtered.value.length
  if (!n) return
  selIdx.value = (selIdx.value + delta + n) % n
  // 滚动到可见
  nextTick(() => {
    const el = listEl.value?.children[selIdx.value] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function pick(name: string): void {
  emit('add', name, props.filter)
}

function confirm(): void {
  const n = filtered.value[selIdx.value]
  if (n) pick(n.name)
}
</script>

<style scoped>
.node-search-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
}
.node-search-box {
  position: fixed;
  width: 380px;
  background: #353535;
  border: 1px solid #4a4a4a;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.nsb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 5px;
  font-size: 11px;
  color: #999;
}
.nsb-title { font-weight: 600; color: #bbb; }
.nsb-filter {
  background: rgba(133, 182, 255, 0.15);
  color: #85b6ff;
  border-radius: 4px;
  padding: 1px 6px;
}
.nsb-count { margin-left: auto; }
.nsb-input {
  margin: 0 8px 6px;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 5px;
  color: #e6e6e6;
  font-size: 13px;
  padding: 6px 9px;
  outline: none;
}
.nsb-input:focus { border-color: #85b6ff; }
.nsb-list {
  max-height: 300px;
  overflow-y: auto;
  padding-bottom: 4px;
}
.nsb-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  font-size: 12.5px;
  color: #ddd;
  cursor: pointer;
}
.nsb-row.sel { background: #4a6ea8; color: #fff; }
.nsb-row .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.nsb-row .nm { white-space: nowrap; }
.nsb-row .cat {
  margin-left: auto;
  font-size: 10.5px;
  color: #888;
  font-family: Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
.nsb-row.sel .cat { color: #cfd9e8; }
.nsb-row.generic .nm { color: #aaa; }
.generic-badge {
  font-size: 10px;
  border: 1px solid #777;
  border-radius: 3px;
  padding: 0 4px;
  color: #999;
  flex: none;
}
.native-badge {
  font-size: 10px;
  border: 1px solid #57a773;
  border-radius: 3px;
  padding: 0 4px;
  color: #7cc79b;
  flex: none;
}
.nsb-empty {
  padding: 16px;
  text-align: center;
  color: #888;
  font-size: 12px;
  line-height: 1.7;
}
.nsb-hidden { color: #6f7885; }
.nsb-showall {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border: 1px solid #3a4350;
  border-radius: 5px;
  background: #222831;
  color: #aab4c2;
  font-size: 11.5px;
  cursor: pointer;
}
.nsb-showall:hover { background: #2c3441; color: #e6ecf4; }
.nsb-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.nsb-meta .nsb-count { margin-left: 0; }
.nsb-native-tag {
  padding: 1px 6px;
  border: 1px solid #2f4a63;
  border-radius: 4px;
  background: rgba(79, 147, 200, 0.12);
  color: #7fb6de;
  font-size: 10.5px;
  white-space: nowrap;
}
</style>
