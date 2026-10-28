<template>
  <nav class="rail">
    <IconBtn :icon="FilePlus2" tip="新建工作流 (Ctrl+N)" tip-pos="right" @click="$emit('new')" />
    <IconBtn :icon="Save" tip="保存 (Ctrl+S)" tip-pos="right" @click="$emit('save')" />
    <IconBtn :icon="SaveAll" tip="另存为" tip-pos="right" @click="$emit('save-as')" />

    <div class="rail-sep"></div>

    <!-- 节点库 / 打开工作流：共用同一块侧边面板，互斥切换 -->
    <IconBtn
      :icon="Library"
      tip="节点库"
      tip-pos="right"
      :active="panelOpen && panelMode === 'nodes'"
      @click="$emit('toggle-panel', 'nodes')"
    />
    <IconBtn
      :icon="FolderOpen"
      tip="打开工作流"
      tip-pos="right"
      :active="panelOpen && panelMode === 'workflows'"
      @click="$emit('toggle-panel', 'workflows')"
    />

    <div class="rail-sep"></div>

    <IconBtn :icon="Puzzle" tip="插件管理" tip-pos="right" @click="$emit('plugins')" />
    <IconBtn :icon="Settings" tip="设置" tip-pos="right" @click="$emit('settings')" />

    <div class="rail-spacer"></div>

    <!-- 适应视图：自定义 SVG（四角取景框），比通用放大图标更贴切 -->
    <button class="icon-btn rail-fit tip-right" data-tip="适应视图" type="button" @click="$emit('fit')">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 8V5.6A2.6 2.6 0 0 1 5.6 3H8" />
        <path d="M16 3h2.4A2.6 2.6 0 0 1 21 5.6V8" />
        <path d="M21 16v2.4A2.6 2.6 0 0 1 18.4 21H16" />
        <path d="M8 21H5.6A2.6 2.6 0 0 1 3 18.4V16" />
        <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
      </svg>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { FilePlus2, Save, SaveAll, Library, FolderOpen, Puzzle, Settings } from 'lucide-vue-next'
import IconBtn from '../ui/IconBtn.vue'

defineProps<{ panelOpen: boolean; panelMode: 'nodes' | 'workflows' }>()
defineEmits<{
  (e: 'new'): void
  (e: 'save'): void
  (e: 'save-as'): void
  (e: 'toggle-panel', mode: 'nodes' | 'workflows'): void
  (e: 'fit'): void
  (e: 'plugins'): void
  (e: 'settings'): void
}>()
</script>

<style scoped>
.rail {
  width: 44px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0;
  background: #15171b;
  border-right: 1px solid #2a2d33;
  z-index: 22;
}
.rail-sep {
  width: 22px;
  height: 1px;
  background: #2c3038;
  margin: 6px 0;
  flex: none;
}
.rail-spacer { flex: 1; }

/* 与 IconBtn 同款按钮外观，只是内容换成内联 SVG */
.rail-fit {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #b9c2ce;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.rail-fit:hover { background: #2e343d; color: #fff; }
</style>
