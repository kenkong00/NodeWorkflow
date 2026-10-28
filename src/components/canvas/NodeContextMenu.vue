<template>
  <div class="ctx-mask" @pointerdown.self="$emit('close')" @contextmenu.prevent="$emit('close')">
    <div class="ctx-menu" :style="{ left: x + 'px', top: y + 'px' }" @pointerdown.stop>
      <div class="ctx-title">
        <component :is="isGroup ? LayoutPanelTop : Square" :size="13" class="ct-icon" />
        <span class="ct-name">{{ req.title }}</span>
        <span class="ct-node">{{ isGroup ? `${req.groupNodes ?? 0} 个节点` : `#${req.nodeId}` }}</span>
      </div>

      <!-- 重命名（内联输入，回车确认 / Esc 取消） -->
      <div v-if="mode === 'rename'" class="ctx-rename">
        <input
          ref="inputEl"
          v-model="draft"
          maxlength="60"
          :placeholder="isGroup ? '组名称' : '节点名称'"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="$emit('close')"
        />
        <button class="rn-ok" title="确定" @click="commitRename">
          <Check :size="13" />
        </button>
        <button class="rn-cancel" title="取消" @click="$emit('close')">
          <X :size="13" />
        </button>
      </div>

      <template v-else-if="isGroup">
        <button class="ctx-row" @click="startRename">
          <Pencil :size="14" /><span>重命名组</span>
          <kbd>双击标题条</kbd>
        </button>

        <div class="ctx-sub">
          <div class="sub-head"><Palette :size="14" /><span>组内节点统一颜色</span></div>
          <div class="swatches">
            <button
              v-for="c in colors"
              :key="c.color"
              class="swatch"
              :style="{ background: c.color }"
              :title="c.name"
              @click="$emit('action', { type: 'color', color: c.color })"
            ></button>
            <button class="swatch reset" title="恢复默认颜色" @click="$emit('action', { type: 'color', color: null })">
              <Ban :size="12" />
            </button>
          </div>
        </div>

        <div class="ctx-sep"></div>

        <button class="ctx-row" :class="{ active: req.groupBypassed }" @click="$emit('action', { type: req.groupBypassed ? 'unbypass' : 'bypass' })">
          <EyeOff :size="14" />
          <span>{{ req.groupBypassed ? '取消忽略组内节点' : '忽略组内全部节点' }}</span>
          <kbd>{{ req.groupNodes ?? 0 }} 个</kbd>
        </button>
        <button class="ctx-row" @click="$emit('action', { type: 'select' })">
          <MousePointerSquareDashed :size="14" /><span>选中组内节点</span>
        </button>
        <button class="ctx-row" @click="$emit('action', { type: 'fit' })">
          <Frame :size="14" /><span>组框贴合内容</span>
        </button>

        <div class="ctx-sep"></div>

        <button class="ctx-row" @click="$emit('action', { type: 'ungroup' })">
          <Ungroup :size="14" /><span>解散组（保留节点）</span>
        </button>
        <button class="ctx-row danger" @click="$emit('action', { type: 'deleteAll' })">
          <Trash2 :size="14" /><span>删除组和组内节点</span>
        </button>
      </template>

      <template v-else>
        <button class="ctx-row" @click="startRename">
          <Pencil :size="14" /><span>重命名</span>
          <kbd>双击标题</kbd>
        </button>

        <div class="ctx-sub">
          <div class="sub-head">
            <Palette :size="14" /><span>{{ multi ? `统一设置 ${req.targets.length} 个节点颜色` : '节点颜色' }}</span>
          </div>
          <div class="swatches">
            <button
              v-for="c in colors"
              :key="c.color"
              class="swatch"
              :class="{ on: !multi && req.color === c.color }"
              :style="{ background: c.color }"
              :title="c.name"
              @click="$emit('action', { type: 'color', color: c.color })"
            ></button>
            <button class="swatch reset" title="恢复默认颜色" @click="$emit('action', { type: 'color', color: null })">
              <Ban :size="12" />
            </button>
          </div>
        </div>

        <div class="ctx-sep"></div>

        <button class="ctx-row" :class="{ active: req.bypassed }" @click="$emit('action', { type: 'bypass' })">
          <EyeOff :size="14" />
          <span>{{ bypassLabel }}</span>
          <kbd>{{ req.bypassed ? '重新参与' : '上游直连下游' }}</kbd>
        </button>
        <button v-if="!multi" class="ctx-row" @click="$emit('action', { type: 'collapse' })">
          <ChevronsDownUp :size="14" /><span>{{ req.collapsed ? '展开节点' : '折叠节点' }}</span>
        </button>
        <button v-if="!multi" class="ctx-row" @click="$emit('action', { type: 'clone' })">
          <Copy :size="14" /><span>克隆节点</span>
        </button>
        <button v-if="!multi" class="ctx-row" @click="$emit('action', { type: 'group' })">
          <LayoutPanelTop :size="14" /><span>把选中节点编成组</span>
          <kbd>Ctrl+G</kbd>
        </button>

        <div class="ctx-sep"></div>

        <button class="ctx-row danger" @click="$emit('action', { type: 'delete' })">
          <Trash2 :size="14" /><span>{{ multi ? `删除选中的 ${req.targets.length} 个节点` : '删除节点' }}</span>
          <kbd>Delete</kbd>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Check, X, Pencil, Palette, EyeOff, Copy, Trash2, ChevronsDownUp, Ban,
  LayoutPanelTop, Square, Frame, Ungroup, MousePointerSquareDashed
} from 'lucide-vue-next'
import { ComfyGraph, type NodeMenuRequest, type MenuAction } from '../../engine/ComfyGraph'

const props = defineProps<{ req: NodeMenuRequest }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', payload: MenuAction): void
  (e: 'rename', title: string): void
}>()

const colors = ComfyGraph.NODE_COLORS
const isGroup = computed(() => props.req.kind === 'group')
const multi = computed(() => (props.req.targets?.length ?? 1) > 1)
const bypassLabel = computed(() =>
  multi.value
    ? `${props.req.bypassed ? '取消忽略' : '忽略'}选中的 ${props.req.targets.length} 个节点`
    : props.req.bypassed
      ? '取消忽略'
      : '忽略此节点'
)

const mode = ref<'menu' | 'rename'>(props.req.intent === 'rename' ? 'rename' : 'menu')
const draft = ref(props.req.intent === 'rename' ? props.req.title : '')
const inputEl = ref<HTMLInputElement>()

// 菜单贴着鼠标但不出屏
const x = computed(() => Math.min(props.req.clientX + 2, window.innerWidth - 244))
const y = computed(() => Math.min(props.req.clientY + 2, window.innerHeight - 400))

function startRename(): void {
  draft.value = props.req.title
  mode.value = 'rename'
}

function commitRename(): void {
  const t = draft.value.trim()
  if (t) emit('rename', t)
  else emit('close')
}

watch(mode, async (m) => {
  if (m !== 'rename') return
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
})
</script>

<style scoped>
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: transparent;
}
.ctx-menu {
  position: fixed;
  width: 236px;
  background: #13171d;
  border: 1px solid #2b3340;
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.66);
  padding: 5px;
  color: #d7dee8;
  font-size: 12.5px;
  user-select: none;
}
.ctx-title {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 7px;
  border-bottom: 1px solid #222933;
  margin-bottom: 4px;
}
.ct-icon { flex: none; color: #7c8797; }
.ct-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fff;
  font-weight: 600;
  font-size: 12.5px;
}
.ct-node { flex: none; font-size: 10.5px; color: #6f7987; font-variant-numeric: tabular-nums; }

.ctx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #d7dee8;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.ctx-row:hover { background: #232b36; color: #fff; }
.ctx-row.active { background: #2f2717; color: #ffc978; }
.ctx-row.danger { color: #ff9b9b; }
.ctx-row.danger:hover { background: #3a2222; }
.ctx-row svg { flex: none; opacity: 0.85; }
.ctx-row kbd {
  margin-left: auto;
  font-family: inherit;
  font-size: 10px;
  color: #6f7987;
  background: #1a1f27;
  border: 1px solid #28303a;
  border-radius: 4px;
  padding: 1px 4px;
}
.ctx-sep { height: 1px; background: #222933; margin: 4px 2px; }

.ctx-sub { padding: 3px 8px 6px; }
.sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #aeb8c6;
  padding: 4px 0 7px;
}
.swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  cursor: pointer;
  padding: 0;
}
.swatch:hover { transform: translateY(-1px); border-color: #fff; }
.swatch.on { box-shadow: 0 0 0 2px #6ea8e8; }
.swatch.reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #1e242e;
  color: #93a0b0;
}

.ctx-rename { display: flex; gap: 5px; padding: 4px 5px 6px; }
.ctx-rename input {
  flex: 1;
  min-width: 0;
  background: #0c1015;
  border: 1px solid #3d86d6;
  border-radius: 6px;
  color: #fff;
  font-size: 12.5px;
  padding: 6px 8px;
  font-family: inherit;
}
.ctx-rename input:focus { outline: none; }
.rn-ok, .rn-cancel {
  width: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid #2b3340;
  background: #1e242e;
  color: #cfd8e3;
  cursor: pointer;
  padding: 0;
}
.rn-ok { background: #2f6fb5; border-color: #3d86d6; color: #fff; }
.rn-ok:hover { background: #3d86d6; }
.rn-cancel:hover { background: #3a2222; color: #ff9b9b; }
</style>
