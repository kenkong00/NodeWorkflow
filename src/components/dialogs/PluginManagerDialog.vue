<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" style="width:720px">
      <div class="modal-head">
        <Puzzle :size="16" style="margin-right:8px;color:#7ab0ff" />
        <span>插件管理</span>
        <button class="x-btn" title="关闭" @click="$emit('close')"><X :size="15" /></button>
      </div>

      <div class="modal-body">
        <!-- 使用说明 -->
        <div class="help-card">
          <div class="help-title">插件是什么？怎么用？</div>
          <ol class="help-list">
            <li>
              <b>插件 = 一个文件夹</b>，放在项目的 <code>plugins/</code> 目录下。里面可以包含新的节点
              （<code>NODE_CLASS_MAPPINGS</code>）、前端扩展，或者一个「执行器」。
            </li>
            <li>
              <b>安装</b>：把 GitHub 仓库地址粘到下面「从 GitHub 安装」，或在 <code>plugins/</code> 下手动解压文件夹，
              然后点「重新加载」。
            </li>
            <li>
              <b>启用 / 停用</b>：停用就是把文件夹改名加 <code>.disabled</code>（和 ComfyUI 的规则一致），
              不会删除任何文件。
            </li>
            <li>
              <b>comfy-executor（内置）</b>：当工作流里含有本机跑不了的扩散模型节点（KSampler、CheckpointLoader…）时，
              它负责把整份工作流转发到你「设置 → ComfyUI 连接」里启用的那台 ComfyUI。
              <span class="hl">纯文本/数值/图像节点的工作流不会走它</span>，所以没开 ComfyUI 也能运行。
            </li>
            <li>
              <b>第三方插件</b>：只要按同样的结构导出节点定义，装进来就会出现在左侧节点库里。
            </li>
          </ol>
        </div>

        <!-- 安装 -->
        <div class="install-row">
          <input v-model="repoUrl" placeholder="https://github.com/用户名/仓库名" spellcheck="false" @keydown.enter="install" />
          <button class="btn primary" :disabled="installing" @click="install">
            <Download :size="14" /><span>{{ installing ? '安装中…' : '从 GitHub 安装' }}</span>
          </button>
          <button class="btn" @click="reload"><RefreshCw :size="14" /><span>重新加载</span></button>
        </div>
        <div v-if="msg" class="install-msg" :class="{ bad: !msgOk }">{{ msg }}</div>

        <!-- 已安装 -->
        <div class="sec-title">已安装插件（{{ store.plugins.length }}）</div>
        <div v-if="!store.plugins.length" class="empty">还没有安装任何插件</div>
        <div v-for="p in store.plugins" :key="p.name" class="plugin-row">
          <span class="p-dot" :class="{ on: p.enabled, bad: !!p.error }"></span>
          <div class="p-main">
            <div class="p-name">
              {{ p.name }}
              <span v-if="p.hasExecutor" class="tag exec">执行器</span>
              <span class="tag">{{ p.nodes.length }} 个节点</span>
            </div>
            <div v-if="p.error" class="p-err">{{ p.error }}</div>
            <div v-else class="p-dir">{{ p.dir }}</div>
          </div>
          <label class="p-switch" :title="p.enabled ? '点击停用' : '点击启用'">
            <input type="checkbox" :checked="p.enabled" @change="toggle(p.name, ($event.target as HTMLInputElement).checked)" />
            <span class="p-slider"></span>
          </label>
          <button class="icon-mini" title="卸载插件（删除 plugins 下的文件夹）" @click="uninstall(p.name)">
            <Trash2 :size="13" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X, Puzzle, Download, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useComfyStore } from '../../stores/comfyStore'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useComfyStore()
const repoUrl = ref('')
const installing = ref(false)
const msg = ref('')
const msgOk = ref(true)

onMounted(() => { void store.loadPlugins() })

async function install(): Promise<void> {
  if (!repoUrl.value.trim()) {
    msg.value = '请先填写 GitHub 仓库地址'
    msgOk.value = false
    return
  }
  installing.value = true
  try {
    const r = await store.installPlugin(repoUrl.value.trim())
    msg.value = r.message
    msgOk.value = r.ok
    if (r.ok) repoUrl.value = ''
  } finally {
    installing.value = false
  }
}

async function reload(): Promise<void> {
  await store.reloadPlugins()
  msg.value = '已重新扫描 plugins/ 目录'
  msgOk.value = true
}

async function toggle(name: string, enable: boolean): Promise<void> {
  await store.togglePlugin(name, enable)
}

async function uninstall(name: string): Promise<void> {
  if (!window.confirm(`确定卸载插件「${name}」？会删除 plugins/${name} 文件夹。`)) return
  await store.uninstallPlugin(name)
  emit('close')
}
</script>

<style scoped>
.x-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: transparent; border: 0; border-radius: 5px;
  color: #8b95a3; cursor: pointer;
}
.x-btn:hover { background: #2a2f37; color: #fff; }

.modal-head { display: flex; align-items: center; }
.help-card {
  background: #1a1e24;
  border: 1px solid #2b313a;
  border-radius: 9px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.help-title { font-size: 12.5px; font-weight: 600; color: #dbe4ef; margin-bottom: 7px; }
.help-list { margin: 0; padding-left: 17px; color: #93a0ae; font-size: 12px; line-height: 1.85; }
.help-list li { margin-bottom: 3px; }
.help-list b { color: #cfdae7; }
.help-list code {
  background: #12151a;
  border: 1px solid #2a3038;
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
  color: #9ec3ea;
}
.help-list .hl { color: #7ee0a3; }

.install-row { display: flex; gap: 8px; margin-bottom: 8px; }
.install-row input {
  flex: 1;
  min-width: 0;
  background: #1b1f25;
  border: 1px solid #2f3641;
  border-radius: 7px;
  color: #dfe6ee;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
}
.install-row input:focus { border-color: #3b6ea8; }
.install-msg { font-size: 11.5px; color: #7ee0a3; margin-bottom: 10px; }
.install-msg.bad { color: #ff9b9b; }

.sec-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #7d8794; margin: 14px 0 8px; }
.empty { color: #6d7683; font-size: 12px; padding: 14px; text-align: center; }

.plugin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid #262b32;
  border-radius: 8px;
  margin-bottom: 6px;
  background: #191d22;
}
.p-dot { width: 7px; height: 7px; border-radius: 50%; background: #5b6472; flex: none; }
.p-dot.on { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.6); }
.p-dot.bad { background: #ef5350; }
.p-main { flex: 1; min-width: 0; }
.p-name { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #e2e9f2; }
.tag { font-size: 9.5px; border: 1px solid #333c48; border-radius: 4px; padding: 0 4px; color: #8b95a3; }
.tag.exec { border-color: #2c5b3f; color: #7ee0a3; }
.p-dir { font-size: 10.5px; color: #6d7683; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-err { font-size: 10.5px; color: #ff9b9b; }

.p-switch { position: relative; width: 32px; height: 18px; flex: none; cursor: pointer; }
.p-switch input { opacity: 0; width: 0; height: 0; }
.p-slider {
  position: absolute; inset: 0;
  background: #2a3038; border-radius: 10px;
  transition: background 0.15s;
}
.p-slider::after {
  content: ''; position: absolute; width: 12px; height: 12px; border-radius: 50%;
  background: #8b95a3; top: 3px; left: 3px; transition: all 0.15s;
}
.p-switch input:checked + .p-slider { background: #1a5fb4; }
.p-switch input:checked + .p-slider::after { left: 17px; background: #fff; }

.icon-mini {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; border-radius: 5px;
  color: #7d8794; cursor: pointer; flex: none;
}
.icon-mini:hover { background: #3a2222; color: #ff9b9b; }
</style>
