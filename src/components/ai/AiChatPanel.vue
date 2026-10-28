<template>
  <section class="ai-panel" :style="{ width: ai.width + 'px' }">
    <!-- 左边拖动改宽度 -->
    <div class="ai-resizer" title="拖动调整宽度" @pointerdown="startResize"></div>

    <header class="ai-head">
      <span class="ai-logo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          <path d="M18 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      </span>
      <span class="ai-title">AI 助手</span>

      <div class="ai-head-right">
        <select
          v-model="prov"
          class="ai-select"
          :title="activeProvider ? `API 供应商：${activeProvider.name}\n端点：${activeProvider.base_url}\n（在「设置 → API 服务商」里配置）` : 'API 供应商（在「设置 → API 服务商」里配置）'"
        >
          <option v-for="p in ai.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          <option v-if="!ai.providers.length" value="">未配置供应商</option>
        </select>
        <select v-model="ai.model" class="ai-select ai-model" title="模型">
          <option v-if="!ai.models.length" :value="ai.model">{{ ai.model || '默认模型' }}</option>
          <option v-for="m in ai.models" :key="m" :value="m">{{ m }}</option>
        </select>
        <button class="ai-icon" title="助手设置" @click="settings = !settings">
          <SlidersHorizontal :size="14" :stroke-width="1.9" />
        </button>
        <button class="ai-icon" title="关掉（可再从右上角图标打开）" @click="ai.toggle(false)">
          <Minus :size="15" :stroke-width="2.1" />
        </button>
      </div>
    </header>

    <!-- 设置浮层 -->
    <div v-if="settings" class="ai-settings">
      <label class="as-row">
        <span>系统提示词</span>
        <textarea v-model="sys" rows="3" placeholder="留空用内置提示词（可操作画布的助手）"></textarea>
      </label>
      <label class="as-row inline">
        <span>温度 {{ ai.temperature.toFixed(2) }}</span>
        <input v-model.number="temp" type="range" min="0" max="1.5" step="0.05" />
      </label>
      <label class="as-row inline">
        <span>允许 AI 直接操作画布</span>
        <input v-model="tools" type="checkbox" />
      </label>
      <div class="as-note">
        AI 能用的工具：查看画布 / 加节点 / 连线 / 改参数 / 打开工作流 / 运行工作流 / 保存工作流。
      </div>
    </div>

    <div class="ai-body" ref="bodyEl">
      <div v-if="!ai.messages.length" class="ai-empty">
        <div class="ae-title">能聊天，也能直接动手改画布</div>
        <div class="ae-sub">试试这些：</div>
        <button v-for="s in SUGGEST" :key="s" class="ae-chip" @click="useSuggest(s)">{{ s }}</button>
        <div v-if="!ai.hasProvider" class="ae-warn">
          还没有配置 API 供应商，先去「设置 → API 服务商」加一个（任意 OpenAI 兼容端点即可）。
        </div>
      </div>

      <AiMessage v-for="m in ai.messages" :key="m.id" :msg="m" />
      <div v-if="ai.lastError" class="ai-err">{{ ai.lastError }}</div>
      <div ref="anchorEl"></div>
    </div>

    <AiComposer
      ref="composerEl"
      :busy="ai.busy"
      :disabled="!ai.hasProvider"
      @send="onSend"
      @stop="ai.stop()"
      @new-session="onNewSession"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Minus, SlidersHorizontal } from 'lucide-vue-next'
import AiMessage from './AiMessage.vue'
import AiComposer from './AiComposer.vue'
import { useAiStore, type AiAttachment } from '../../stores/useAiStore'

const ai = useAiStore()
const settings = ref(false)
const bodyEl = ref<HTMLElement | null>(null)
const anchorEl = ref<HTMLElement | null>(null)
const composerEl = ref<InstanceType<typeof AiComposer> | null>(null)

const prov = computed({
  get: () => ai.providerId,
  set: (v: string) => ai.setProvider(v)
})
const sys = computed({
  get: () => ai.systemPrompt,
  set: (v: string) => ai.updateSettings({ systemPrompt: v })
})
const temp = computed({
  get: () => ai.temperature,
  set: (v: number) => ai.updateSettings({ temperature: v })
})
const tools = computed({
  get: () => ai.useTools,
  set: (v: boolean) => ai.updateSettings({ useTools: v })
})
/** 当前选中的供应商（用于头部提示，一眼看出连的是哪个端点） */
const activeProvider = computed(() => ai.providers.find((p) => p.id === ai.providerId) || null)

const SUGGEST = [
  '看看现在画布上有什么',
  '帮我搭一个：文本输入 → 文本显示 的工作流',
  '列出所有能用的图像节点',
  '把当前工作流保存起来'
]

function useSuggest(s: string): void {
  composerEl.value?.focus()
  void onSend({ text: s, atts: [] })
}

async function onSend(payload: { text: string; atts: AiAttachment[] }): Promise<void> {
  await ai.send(payload.text, payload.atts)
  scrollBottom()
}

function onNewSession(): void {
  ai.newSession()
  composerEl.value?.focus()
}

function scrollBottom(): void {
  nextTick(() => anchorEl.value?.scrollIntoView({ block: 'end' }))
}

watch(
  () => ai.messages.map((m) => m.text.length).join(','),
  () => {
    if (ai.busy) scrollBottom()
  }
)

// ---- 拖左边改宽度 ----
function startResize(e: PointerEvent): void {
  e.preventDefault()
  const startX = e.clientX
  const startW = ai.width
  const move = (ev: PointerEvent) => {
    // 面板靠右：往左拖变宽
    ai.setWidth(startW + (startX - ev.clientX))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

onMounted(() => {
  void (async () => {
    // 每次打开都重新拉一次：用户可能刚在设置里新增/启用了供应商
    await ai.loadProviders()
    if (ai.providerId && !ai.models.length) await ai.loadModels()
  })()
  nextTick(() => composerEl.value?.focus())
})
</script>

<style scoped>
.ai-panel {
  position: absolute;
  top: 10px;
  right: 12px;
  bottom: 10px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: #14171b;
  border: 1px solid #2c313a;
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.ai-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: ew-resize;
  z-index: 2;
}
.ai-resizer:hover { background: rgba(58, 111, 168, 0.35); }

.ai-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 11px;
  border-bottom: 1px solid #262b33;
  background: #171a1f;
  flex: none;
}
.ai-logo { display: inline-flex; color: #7ab0ff; }
.ai-title { font-size: 12.5px; font-weight: 600; color: #e6ecf4; letter-spacing: 0.3px; }

.ai-head-right { margin-left: auto; display: flex; align-items: center; gap: 4px; min-width: 0; }
.ai-select {
  max-width: 118px;
  height: 24px;
  background: #1e2229;
  border: 1px solid #2d323a;
  border-radius: 6px;
  color: #b9c2ce;
  font-size: 11px;
  padding: 0 4px;
  outline: none;
}
.ai-select:focus { border-color: #3b6ea8; }
.ai-model { max-width: 132px; }
.ai-icon {
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
  flex: none;
}
.ai-icon:hover { background: #262c35; color: #fff; }

.ai-settings {
  flex: none;
  border-bottom: 1px solid #262b33;
  background: #171a1f;
  padding: 8px 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.as-row { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: #8b95a3; }
.as-row.inline { flex-direction: row; align-items: center; justify-content: space-between; }
.as-row textarea {
  width: 100%;
  background: #101317;
  border: 1px solid #2d323a;
  border-radius: 7px;
  color: #dfe6ee;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 6px 7px;
  outline: none;
  resize: vertical;
  font-family: inherit;
}
.as-row textarea:focus { border-color: #3b6ea8; }
.as-row input[type='range'] { accent-color: #1a5fb4; flex: 1; max-width: 150px; }
.as-row input[type='checkbox'] { accent-color: #1a5fb4; }
.as-note { font-size: 10.5px; color: #6d7683; line-height: 1.6; }

.ai-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; }

.ai-empty { padding: 18px 16px; }
.ae-title { font-size: 13px; color: #cdd7e3; font-weight: 600; margin-bottom: 6px; }
.ae-sub { font-size: 11.5px; color: #6d7683; margin-bottom: 8px; }
.ae-chip {
  display: block;
  width: 100%;
  text-align: left;
  background: #1c2027;
  border: 1px solid #2c313a;
  border-radius: 8px;
  color: #b7c1cd;
  font-size: 11.5px;
  padding: 6px 9px;
  margin-bottom: 5px;
  cursor: pointer;
}
.ae-chip:hover { border-color: #3b6ea8; color: #fff; }
.ae-warn {
  margin-top: 10px;
  font-size: 11px;
  color: #ffc48e;
  background: #33291a;
  border: 1px solid #4d3d22;
  border-radius: 8px;
  padding: 7px 9px;
  line-height: 1.6;
}

.ai-err {
  margin: 8px 12px;
  font-size: 11.5px;
  color: #ffb4b4;
  background: #3a2222;
  border: 1px solid #5c2c2c;
  border-radius: 8px;
  padding: 7px 9px;
  line-height: 1.6;
}
</style>
