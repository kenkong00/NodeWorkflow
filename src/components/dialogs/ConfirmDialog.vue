<template>
  <!--
    项目内统一的确认/输入弹窗，替代 window.confirm / alert / prompt。
    支持三种形态：
      - confirm：确认 + 取消（danger=true 时主按钮变红）
      - alert：只有一个「知道了」
      - prompt：带输入框，确认时把值回传
  -->
  <div class="modal-mask" @click.self="cancel">
    <div class="modal cd-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <AlertTriangle v-if="danger" :size="15" :stroke-width="2" class="cd-icon danger" />
        <Info v-else :size="15" :stroke-width="2" class="cd-icon" />
        <span>{{ title }}</span>
        <button class="x" title="关闭" @click="cancel">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="message" class="cd-msg">{{ message }}</div>

        <input
          v-if="mode === 'prompt'"
          ref="inputEl"
          v-model="value"
          class="cd-input"
          :placeholder="placeholder"
          spellcheck="false"
          @keydown.enter.prevent="ok"
          @keydown.esc.prevent="cancel"
        />
      </div>

      <div class="modal-foot">
        <button v-if="mode !== 'alert'" class="cd-btn" @click="cancel">{{ cancelText }}</button>
        <button class="cd-btn primary" :class="{ danger }" @click="ok" ref="okEl">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { AlertTriangle, Info } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    title: string
    message?: string
    mode?: 'confirm' | 'alert' | 'prompt'
    confirmText?: string
    cancelText?: string
    danger?: boolean
    defaultValue?: string
    placeholder?: string
  }>(),
  {
    message: '',
    mode: 'confirm',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    defaultValue: '',
    placeholder: ''
  }
)

const emit = defineEmits<{ (e: 'confirm', value?: string): void; (e: 'close'): void }>()

const value = ref(props.defaultValue)
const inputEl = ref<HTMLInputElement | null>(null)
const okEl = ref<HTMLButtonElement | null>(null)

onMounted(async () => {
  await nextTick()
  if (props.mode === 'prompt') {
    inputEl.value?.focus()
    inputEl.value?.select()
  } else {
    okEl.value?.focus()
  }
})

function ok(): void {
  if (props.mode === 'prompt') {
    const v = value.value.trim()
    if (!v) {
      inputEl.value?.focus()
      return
    }
    emit('confirm', v)
  } else {
    emit('confirm')
  }
  emit('close')
}

function cancel(): void {
  emit('close')
}
</script>

<style scoped>
.cd-modal { width: 420px; }
.cd-icon { color: #7fa8dd; flex: none; }
.cd-icon.danger { color: #e8935c; }
.modal-head { gap: 8px; }

.cd-msg {
  font-size: 13px;
  line-height: 1.75;
  color: #ccd5e0;
  white-space: pre-line;
}

.cd-input {
  width: 100%;
  margin-top: 12px;
  background: #0f1216;
  border: 1px solid #3a4653;
  border-radius: 7px;
  color: #eef3fa;
  font-size: 13.5px;
  padding: 8px 10px;
  font-family: inherit;
}
.cd-input:focus { outline: none; border-color: #2a6fd4; box-shadow: 0 0 0 2px rgba(42, 111, 212, 0.25); }

.cd-btn {
  height: 30px;
  padding: 0 16px;
  border-radius: 7px;
  border: 1px solid #3a4653;
  background: #22272e;
  color: #cdd6e2;
  font-size: 12.5px;
  cursor: pointer;
}
.cd-btn:hover { background: #2b313a; color: #fff; }
.cd-btn.primary {
  background: #1a5fb4;
  border-color: #2a72cc;
  color: #fff;
}
.cd-btn.primary:hover { background: #2170cd; }
.cd-btn.primary.danger {
  background: #8d2f2f;
  border-color: #a53a3a;
}
.cd-btn.primary.danger:hover { background: #a53838; }
</style>
