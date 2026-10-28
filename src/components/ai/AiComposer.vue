<template>
  <div class="ac-wrap">
    <div v-if="atts.length" class="ac-atts">
      <div v-for="a in atts" :key="a.id" class="ac-att">
        <img v-if="a.kind === 'image' && a.dataUrl" :src="a.dataUrl" :alt="a.name" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="ac-att-name">{{ a.name }}</span>
        <button class="ac-att-x" title="移除" @click="removeAtt(a.id)">
          <X :size="11" :stroke-width="2.4" />
        </button>
      </div>
    </div>

    <div class="ac-box" :class="{ focus: focused }">
      <textarea
        ref="ta"
        v-model="draft"
        class="ac-input"
        :placeholder="placeholder"
        rows="1"
        @input="autoGrow"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter.exact.prevent="doSend"
        @keydown.esc="draft = ''"
      ></textarea>

      <div class="ac-actions">
        <div class="ac-left">
          <button class="ac-btn" title="上传图片或文本文件" @click="pick">
            <Paperclip :size="15" :stroke-width="1.9" />
          </button>
          <button class="ac-btn" title="开新对话" @click="$emit('new-session')">
            <Plus :size="15" :stroke-width="1.9" />
          </button>
          <span class="ac-hint">Enter 发送 · Shift+Enter 换行</span>
        </div>
        <button v-if="busy" class="ac-stop" title="停止生成" @click="$emit('stop')">
          <Square :size="13" fill="currentColor" />
        </button>
        <button v-else class="ac-send" :class="{ on: canSend }" :disabled="!canSend" title="发送" @click="doSend">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>

    <input
      ref="fileEl"
      type="file"
      multiple
      accept="image/*,.txt,.md,.json,.csv,.log,.yaml,.yml,.xml,.html,.js,.ts,.py"
      style="display:none"
      @change="onFiles"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Paperclip, Plus, Square, X } from 'lucide-vue-next'
import type { AiAttachment } from '../../stores/useAiStore'

const props = defineProps<{ busy: boolean; disabled?: boolean }>()
const emit = defineEmits<{
  (e: 'send', payload: { text: string; atts: AiAttachment[] }): void
  (e: 'stop'): void
  (e: 'new-session'): void
}>()

const draft = ref('')
const atts = ref<AiAttachment[]>([])
const focused = ref(false)
const ta = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)

const placeholder = computed(() =>
  props.disabled ? '先在「设置 → API 服务商」里配置一个供应商，才能开始对话' : '问点什么，或直接说「帮我搭一个…的工作流」'
)
const canSend = computed(() => !props.busy && !props.disabled && (!!draft.value.trim() || atts.value.length > 0))

const MAX_H = 168
function autoGrow(): void {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`
  el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden'
}

function doSend(): void {
  if (!canSend.value) return
  const text = draft.value
  const list = atts.value
  draft.value = ''
  atts.value = []
  nextTick(autoGrow)
  emit('send', { text, atts: list })
}

function removeAtt(id: string): void {
  atts.value = atts.value.filter((a) => a.id !== id)
}

function pick(): void {
  fileEl.value?.click()
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i
const TEXT_RE = /\.(txt|md|json|csv|log|ya?ml|xml|html|js|ts|py)$/i
const MAX_BYTES = 8 * 1024 * 1024

async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  for (const f of files) {
    if (f.size > MAX_BYTES) continue
    const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    if (IMAGE_RE.test(f.name)) {
      const dataUrl = await readAsDataUrl(f)
      atts.value.push({ id, kind: 'image', name: f.name, size: f.size, dataUrl })
    } else if (TEXT_RE.test(f.name) || f.type.startsWith('text/')) {
      const text = (await f.text()).slice(0, 60000)
      atts.value.push({ id, kind: 'text', name: f.name, size: f.size, text })
    } else {
      // 其它二进制：只带名字，让模型知道有这个文件
      atts.value.push({ id, kind: 'file', name: f.name, size: f.size })
    }
  }
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(f)
  })
}

function focus(): void {
  ta.value?.focus()
}
defineExpose({ focus })
</script>

<style scoped>
.ac-wrap { padding: 8px 10px 10px; border-top: 1px solid #262b33; background: #14171b; }

.ac-atts { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.ac-att {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #1c2027;
  border: 1px solid #2c313a;
  border-radius: 7px;
  padding: 3px 6px;
  color: #97a3b3;
  font-size: 11px;
}
.ac-att img { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; display: block; }
.ac-att-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cfd8e3; }
.ac-att-x { border: 0; background: transparent; color: #7d8794; cursor: pointer; padding: 0; display: inline-flex; }
.ac-att-x:hover { color: #ff9b9b; }

.ac-box {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #1a1e24;
  padding: 7px 8px 6px;
  transition: border-color 0.14s ease;
}
.ac-box.focus { border-color: #3b6ea8; }

.ac-input {
  display: block;
  width: 100%;
  min-height: 20px;
  max-height: 168px;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: #e3eaf3;
  font-size: 12.5px;
  line-height: 1.6;
  font-family: inherit;
  overflow-y: hidden;
}
.ac-input::placeholder { color: #626b78; }

.ac-actions { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.ac-left { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; }
.ac-btn {
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
.ac-btn:hover { background: #262c35; color: #fff; }
.ac-hint { font-size: 10.5px; color: #565f6c; margin-left: 4px; white-space: nowrap; }

.ac-send, .ac-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: #262c35;
  color: #6d7683;
  cursor: pointer;
  flex: none;
}
.ac-send.on { background: #1a5fb4; color: #fff; }
.ac-send.on:hover { background: #2070d0; }
.ac-stop { background: #3b2a2a; color: #ff9b9b; }
.ac-stop:hover { background: #4a3333; }
</style>
