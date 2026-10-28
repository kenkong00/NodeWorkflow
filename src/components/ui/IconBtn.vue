<template>
  <button
    class="icon-btn"
    :class="[`tip-${tipPos}`, { active, primary, danger, wide, 'is-running': pulse }]"
    :data-tip="tip || undefined"
    :disabled="disabled"
    type="button"
    @click="$emit('click', $event)"
  >
    <component :is="icon" :size="size" :stroke-width="1.9" />
    <span v-if="badge" class="ib-badge">{{ badge }}</span>
    <slot />
  </button>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    /** 悬停时显示的功能名称（纯中文短名） */
    tip?: string
    size?: number
    active?: boolean
    primary?: boolean
    danger?: boolean
    disabled?: boolean
    /** 运行中呼吸动画 */
    pulse?: boolean
    /** 加长按钮（运行按钮） */
    wide?: boolean
    /** 角标数字 */
    badge?: number
    tipPos?: 'right' | 'bottom' | 'left'
  }>(),
  { size: 17, tipPos: 'bottom' }
)

defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
</script>

<style scoped>
.icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #b9c2ce;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.icon-btn:hover { background: #2e343d; color: #fff; }
.icon-btn:active { transform: translateY(0.5px); }
.icon-btn.active { background: #2b3440; color: #fff; border-color: #3a4553; }
.icon-btn.primary {
  background: #1a5fb4;
  border-color: #2a6fd4;
  color: #fff;
}
.icon-btn.primary:hover { background: #2471d0; }
.icon-btn.danger { color: #ff8e8e; }
.icon-btn.danger:hover { background: #4a2222; color: #ffb4b4; }
.icon-btn.wide { width: 62px; }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn:disabled:hover { background: transparent; color: #b9c2ce; }

/* 运行中：四周由暗到亮的呼吸，表示"任务在跑" */
.icon-btn.is-running {
  animation: runPulse 1.25s ease-in-out infinite;
}
@keyframes runPulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(122, 176, 255, 0.1), 0 0 6px 0 rgba(122, 176, 255, 0.12) inset;
    background: #1a5fb4;
  }
  50% {
    box-shadow: 0 0 0 3px rgba(122, 176, 255, 0.28), 0 0 14px 2px rgba(122, 176, 255, 0.3) inset;
    background: #2a74d4;
  }
}

.ib-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 8px;
  background: #d9534f;
  color: #fff;
  font-size: 10px;
  line-height: 15px;
  text-align: center;
  font-weight: 600;
  box-shadow: 0 0 0 2px #171718;
}

/* 自定义悬停提示（比原生 title 更快、更统一） */
.icon-btn[data-tip]::before,
.icon-btn[data-tip]::after {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease 0.15s;
  position: absolute;
  z-index: 60;
}
.icon-btn[data-tip]::after {
  content: attr(data-tip);
  white-space: nowrap;
  background: #0e1116;
  border: 1px solid #39414d;
  color: #e9eef6;
  font-size: 11.5px;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 5px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.icon-btn[data-tip]:hover::after { opacity: 1; }

.icon-btn.tip-bottom[data-tip]::after { top: calc(100% + 7px); left: 50%; transform: translateX(-50%); }
.icon-btn.tip-right[data-tip]::after { left: calc(100% + 9px); top: 50%; transform: translateY(-50%); }
.icon-btn.tip-left[data-tip]::after { right: calc(100% + 9px); top: 50%; transform: translateY(-50%); }
</style>
