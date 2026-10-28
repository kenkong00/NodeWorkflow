<template>
  <div class="ai-msg" :class="msg.role">
    <div class="am-avatar">
      <template v-if="msg.role === 'user'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
        </svg>
      </template>
      <template v-else>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          <path d="M18 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      </template>
    </div>

    <div class="am-body">
      <!-- 附件 -->
      <div v-if="msg.attachments?.length" class="am-atts">
        <div v-for="a in msg.attachments" :key="a.id" class="am-att">
          <img v-if="a.kind === 'image' && a.dataUrl" :src="a.dataUrl" :alt="a.name" class="am-att-img" />
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div class="am-att-meta">
            <span class="am-att-name">{{ a.name }}</span>
            <span class="am-att-size">{{ a.kind === 'image' ? '图片' : '文本' }} · {{ kb(a.size) }}</span>
          </div>
        </div>
      </div>

      <!-- 工具调用过程 -->
      <div v-if="msg.steps?.length" class="am-steps">
        <div v-for="s in msg.steps" :key="s.id" class="am-step" :class="{ open: opened.has(s.id) }">
          <button class="am-step-head" @click="toggle(s.id)">
            <span class="am-step-dot" :class="s.status"></span>
            <span class="am-step-name">{{ s.name }}</span>
            <span class="am-step-args">{{ shortArgs(s.args) }}</span>
            <ChevronRight :size="12" class="am-step-arrow" :class="{ open: opened.has(s.id) }" />
          </button>
          <div v-if="opened.has(s.id)" class="am-step-body">
            <pre class="am-step-json">{{ s.args }}</pre>
            <pre v-if="s.result" class="am-step-result">{{ s.result }}</pre>
          </div>
        </div>
      </div>

      <!-- 正文 -->
      <div v-if="msg.role === 'user'" class="am-text-user">{{ msg.text }}</div>
      <div v-else class="am-md" v-html="html"></div>

      <div v-if="msg.streaming && !msg.text" class="am-typing">
        <span></span><span></span><span></span>
      </div>
      <div v-if="msg.error" class="am-error">{{ msg.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { renderMarkdown } from '../../utils/markdown'
import type { AiMessage as Msg } from '../../stores/useAiStore'

const props = defineProps<{ msg: Msg }>()
const opened = ref<Set<string>>(new Set())

function toggle(id: string): void {
  if (opened.value.has(id)) opened.value.delete(id)
  else opened.value.add(id)
}

const html = computed(() => renderMarkdown(props.msg.text || ''))

function shortArgs(args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    return Object.entries(o)
      .map(([k, v]) => `${k}=${String(v).slice(0, 22)}`)
      .join(' · ')
      .slice(0, 70)
  } catch {
    return args.slice(0, 70)
  }
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.ai-msg { display: flex; gap: 8px; padding: 10px 12px; }
.ai-msg.user { flex-direction: row-reverse; }

.am-avatar {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #23272e;
  color: #8fa3bd;
  margin-top: 2px;
}
.ai-msg.user .am-avatar { background: #1e3a5f; color: #9ec5f5; }

.am-body { min-width: 0; max-width: calc(100% - 34px); }
.ai-msg.user .am-body { display: flex; flex-direction: column; align-items: flex-end; }

.am-text-user {
  background: #1f2b3a;
  border: 1px solid #2c3d52;
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12.5px;
  line-height: 1.65;
  color: #dbe6f3;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
}

.am-atts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.am-att {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1c2027;
  border: 1px solid #2c313a;
  border-radius: 8px;
  padding: 4px 8px 4px 4px;
  color: #97a3b3;
}
.am-att-img { width: 26px; height: 26px; object-fit: cover; border-radius: 5px; display: block; }
.am-att-meta { display: flex; flex-direction: column; line-height: 1.25; }
.am-att-name { font-size: 11.5px; color: #cfd8e3; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-att-size { font-size: 10px; color: #6d7683; }

.am-steps { display: flex; flex-direction: column; gap: 3px; margin-bottom: 7px; }
.am-step { border: 1px solid #262b33; border-radius: 8px; background: #16191e; overflow: hidden; }
.am-step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: transparent;
  border: 0;
  color: #93a0b0;
  font-size: 11.5px;
  padding: 5px 7px;
  cursor: pointer;
  text-align: left;
}
.am-step-head:hover { background: #1d222a; }
.am-step-dot { width: 6px; height: 6px; border-radius: 50%; background: #5b6472; flex: none; }
.am-step-dot.running { background: #e8a33d; box-shadow: 0 0 6px #e8a33d; }
.am-step-dot.done { background: #4ade80; }
.am-step-dot.error { background: #f87171; }
.am-step-name { font-family: ui-monospace, Menlo, Consolas, monospace; color: #cfe0f5; flex: none; }
.am-step-args { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6d7683; }
.am-step-arrow { transition: transform 0.14s ease; flex: none; }
.am-step-arrow.open { transform: rotate(90deg); }
.am-step-body { border-top: 1px solid #262b33; padding: 6px 8px; }
.am-step-json, .am-step-result {
  margin: 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: #9aa8b8;
  white-space: pre-wrap;
  word-break: break-word;
}
.am-step-result { margin-top: 5px; color: #7f8b99; max-height: 180px; overflow: auto; }

.am-md { font-size: 12.5px; line-height: 1.7; color: #dbe3ed; word-break: break-word; }

.am-typing { display: inline-flex; gap: 3px; padding: 4px 2px; }
.am-typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #5f6b7a;
  animation: am-blink 1.1s infinite ease-in-out;
}
.am-typing span:nth-child(2) { animation-delay: 0.15s; }
.am-typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes am-blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

.am-error {
  margin-top: 6px;
  font-size: 11.5px;
  color: #ffb4b4;
  background: #3a2222;
  border: 1px solid #5c2c2c;
  border-radius: 7px;
  padding: 6px 8px;
  white-space: pre-wrap;
}
</style>
