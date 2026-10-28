<template>
  <footer class="queuebar">
    <span class="q-state" :class="stateClass">
      <span class="dot"></span>
      {{ stateText }}
    </span>

    <span v-if="store.exec.status === 'running' && store.exec.currentNode" class="q-node">
      {{ store.exec.currentNodeTitle || store.exec.currentNode }}
      <span v-if="store.exec.progress > 0"> · {{ Math.round(store.exec.progress * 100) }}%</span>
    </span>

    <span v-if="store.exec.lastError" class="q-error" :title="store.exec.lastError">
      {{ store.exec.lastError }}
    </span>

    <span class="q-spacer"></span>
    <span v-if="store.exec.running" class="q-chip live">运行中 1</span>
    <span v-if="store.exec.pending.length" class="q-chip">排队 {{ store.exec.pending.length }}</span>
    <span class="q-target">本机执行引擎</span>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useComfyStore } from '../../stores/comfyStore'

const store = useComfyStore()

const stateText = computed(() => {
  switch (store.exec.status) {
    case 'running': return '运行中'
    case 'error': return '执行出错'
    case 'interrupted': return '已停止'
    default: return '就绪'
  }
})

const stateClass = computed(() => ({
  'is-running': store.exec.status === 'running',
  'is-error': store.exec.status === 'error',
  'is-idle': store.exec.status === 'idle'
}))
</script>

<style scoped>
.queuebar {
  height: 26px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: #15171b;
  border-top: 1px solid #2a2d33;
  font-size: 11.5px;
  color: #8b95a3;
  z-index: 25;
}
.q-state { display: inline-flex; align-items: center; gap: 5px; }
.q-state .dot { width: 6px; height: 6px; border-radius: 50%; background: #5b6472; }
.q-state.is-running .dot { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.q-state.is-error .dot { background: #ef5350; box-shadow: 0 0 6px #ef5350; }
.q-state.is-idle .dot { background: #4a5568; }
.q-node { color: #b6c2d0; }
.q-error {
  color: #ff9b9b;
  max-width: 46vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-spacer { flex: 1; }
.q-chip {
  border: 1px solid #2f3742;
  border-radius: 8px;
  padding: 0 7px;
  line-height: 15px;
  color: #9aa5b3;
}
.q-chip.live { border-color: #2c5b3f; color: #7ee0a3; }
.q-target { color: #6d7683; }
</style>
