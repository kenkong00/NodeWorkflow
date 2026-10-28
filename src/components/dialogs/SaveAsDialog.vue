<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal saveas" style="width:460px">
      <div class="modal-head">
        <span>另存为</span>
        <button class="x-btn" title="关闭" @click="$emit('close')">
          <X :size="15" />
        </button>
      </div>

      <div class="modal-body">
        <div class="sa-row">
          <label>工作流名称</label>
          <input
            ref="inputEl"
            v-model="name"
            maxlength="80"
            placeholder="给工作流起个名字"
            @keydown.enter.prevent="commit"
            @keydown.esc.prevent="$emit('close')"
          />
        </div>

        <div v-if="dupHit" class="sa-warn">
          <AlertTriangle :size="14" />
          <span>已存在同名工作流「{{ dupHit.name }}」，保存将覆盖它的内容。</span>
        </div>

        <div class="sa-tip">
          <Info :size="13" />
          <span>另存为会创建一个新的工作流，当前标签页会切换到新工作流，原工作流保持不变。</span>
        </div>

        <div class="sa-list">
          <div class="sa-list-title">已保存的工作流（{{ list.length }}）</div>
          <div v-if="!list.length" class="sa-empty">还没有保存过任何工作流</div>
          <button
            v-for="w in list"
            :key="w.id"
            class="sa-item"
            :class="{ on: name.trim() === w.name }"
            @click="name = w.name"
          >
            <Layers :size="13" />
            <span class="si-name">{{ w.name }}</span>
            <span class="si-time">{{ new Date(w.updated_at).toLocaleString() }}</span>
          </button>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!name.trim()" @click="commit">
          {{ dupHit ? '覆盖保存' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { X, AlertTriangle, Info, Layers } from 'lucide-vue-next'
import type { WorkflowMeta } from '../../stores/comfyStore'

const props = defineProps<{ defaultName: string; list: WorkflowMeta[]; currentId?: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: { name: string; overwriteId: string | null }): void
}>()

const name = ref(props.defaultName)
const inputEl = ref<HTMLInputElement>()

// 同名工作流（排除当前工作流自己）
const dupHit = computed(() => {
  const n = name.value.trim()
  if (!n) return null
  return props.list.find((w) => w.name === n && w.id !== props.currentId) || null
})

function commit(): void {
  const n = name.value.trim()
  if (!n) return
  emit('save', { name: n, overwriteId: dupHit.value?.id ?? null })
}

onMounted(async () => {
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
})
</script>

<style scoped>
.saveas .modal-body { padding: 16px; }
.sa-row { display: flex; align-items: center; gap: 10px; }
.sa-row label { width: 84px; flex: none; font-size: 12.5px; color: #98a3b1; }
.sa-row input {
  flex: 1;
  min-width: 0;
  background: #0f1216;
  border: 1px solid #3a4653;
  border-radius: 7px;
  color: #eef3fa;
  font-size: 13.5px;
  padding: 8px 10px;
  font-family: inherit;
}
.sa-row input:focus { outline: none; border-color: #2a6fd4; box-shadow: 0 0 0 2px rgba(42, 111, 212, 0.25); }

.sa-warn {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 12px;
  background: #322512;
  border: 1px solid #6b4d1c;
  color: #ffce85;
  font-size: 12px;
  line-height: 1.55;
  padding: 7px 10px;
  border-radius: 7px;
}
.sa-warn svg { flex: none; margin-top: 1px; }
.sa-tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  color: #7f8a99;
  font-size: 11.5px;
  line-height: 1.55;
}
.sa-tip svg { flex: none; margin-top: 1px; }

.sa-list { margin-top: 14px; border-top: 1px solid #2a313a; padding-top: 10px; }
.sa-list-title { font-size: 11px; color: #78828f; margin-bottom: 6px; letter-spacing: 0.3px; }
.sa-empty { color: #667080; font-size: 12px; padding: 10px 2px; }
.sa-list { max-height: 190px; overflow-y: auto; }
.sa-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: #c6cfdb;
  font-size: 12.5px;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.sa-item:hover { background: #232a33; }
.sa-item.on { background: #1d2c40; border-color: #2f5c94; color: #fff; }
.sa-item svg { flex: none; color: #79838f; }
.si-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.si-time { flex: none; font-size: 10.5px; color: #6d7683; }

.x-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: #8b95a3;
  cursor: pointer;
}
.x-btn:hover { background: #2a2f37; color: #fff; }
</style>
