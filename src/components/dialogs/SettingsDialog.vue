<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="settings">
      <!-- 左：分区导航 -->
      <div class="st-nav">
        <div class="st-nav-title">设置</div>
        <button
          v-for="sec in SECTIONS"
          :key="sec.key"
          class="st-nav-item"
          :class="{ active: section === sec.key }"
          @click="section = sec.key"
        >
          <component :is="sec.icon" :size="15" :stroke-width="1.9" />
          <span>{{ sec.label }}</span>
        </button>
        <div class="st-nav-foot">本地执行引擎 v0.2</div>
      </div>

      <!-- 右：内容 -->
      <div class="st-main">
        <div class="st-head">
          <span>{{ currentLabel }}</span>
          <button class="x-btn" title="关闭" @click="$emit('close')"><X :size="15" /></button>
        </div>

        <!-- ============ ComfyUI ============ -->
        <div v-if="section === 'comfy'" class="st-body">
          <p class="st-desc">
            本系统的文本 / 数值 / 图像类节点全部<b>本机直接执行</b>，不需要 ComfyUI。
            只有当你用到扩散模型节点（KSampler、CheckpointLoader 等）时，才会把工作流转发给下面启用的 ComfyUI 服务器。
          </p>

          <div class="st-split">
            <!-- 列表 -->
            <div class="st-list">
              <button
                v-for="c in comfyConfigs"
                :key="c.id || c.__key"
                class="st-item"
                :class="{ active: selectedComfy === c.__key }"
                @click="selectedComfy = c.__key!"
              >
                <span class="st-dot" :class="comfyStatus[c.__key!] || 'unknown'"></span>
                <span class="st-item-name">{{ c.name || '未命名连接' }}</span>
                <span v-if="c.is_active" class="st-tag">使用中</span>
              </button>
              <button class="st-add" @click="addComfy"><Plus :size="13" /> 新增连接</button>
            </div>

            <!-- 详情 -->
            <div class="st-detail" v-if="activeComfy">
              <div class="field">
                <label>名称</label>
                <input v-model="activeComfy.name" placeholder="本地 ComfyUI" />
              </div>
              <div class="field">
                <label>地址</label>
                <input v-model="activeComfy.url" placeholder="http://127.0.0.1:8188" spellcheck="false" />
              </div>
              <p class="field-tip">默认 ComfyUI 端口是 8188；如果开了跨域限制，可用本项目的「启动ComfyUI-跨域」脚本启动。</p>

              <div class="test-row">
                <button class="btn" :disabled="testingComfy" @click="testComfy(activeComfy)">
                  <PlugZap :size="14" />
                  <span>{{ testingComfy ? '测试中…' : '测试连接' }}</span>
                </button>
                <span v-if="comfyResult[activeComfy.__key!]" class="test-res" :class="comfyResult[activeComfy.__key!]!.ok ? 'ok' : 'bad'">
                  <component :is="comfyResult[activeComfy.__key!]!.ok ? CheckCircle2 : XCircle" :size="14" />
                  {{ comfyResult[activeComfy.__key!]!.text }}
                </span>
              </div>

              <div class="detail-foot">
                <button class="btn" @click="saveComfy(activeComfy)">
                  <Save :size="14" /><span>保存</span>
                </button>
                <button
                  class="btn"
                  :disabled="activeComfy.is_active"
                  @click="activateComfy(activeComfy)"
                >
                  <Check :size="14" /><span>{{ activeComfy.is_active ? '当前使用中' : '设为默认' }}</span>
                </button>
                <button class="btn danger" @click="delComfy(activeComfy)">
                  <Trash2 :size="14" /><span>删除</span>
                </button>
              </div>
            </div>
            <div class="st-detail st-empty" v-else>
              <ServerOff :size="26" />
              <p>还没有 ComfyUI 连接</p>
              <span>点左侧「新增连接」添加一个，例如 http://127.0.0.1:8188</span>
            </div>
          </div>
        </div>

        <!-- ============ API 服务商 ============ -->
        <div v-if="section === 'llm'" class="st-body">
          <p class="st-desc">
            这里配置的大模型服务商会出现在节点库「llm」分类的 <b>API服务商</b> 节点里，
            供「文本处理」「聊天」节点调用。每个服务商可以单独测试连通性。
          </p>

          <div class="st-split">
            <div class="st-list">
              <button
                v-for="p in providers"
                :key="p.id || p.__key"
                class="st-item"
                :class="{ active: selectedProvider === p.__key }"
                @click="selectedProvider = p.__key!"
              >
                <span class="st-dot" :class="llmStatus[p.__key!] || 'unknown'"></span>
                <span class="st-item-name">{{ p.name || '未命名服务商' }}</span>
                <span v-if="p.enabled" class="st-tag">启用</span>
              </button>
              <button class="st-add" @click="addProvider"><Plus :size="13" /> 新增服务商</button>
            </div>

            <div class="st-detail" v-if="activeProvider">
              <div class="field">
                <label>名称</label>
                <input v-model="activeProvider.name" placeholder="OpenAI" />
              </div>
              <div class="field">
                <label>Base URL</label>
                <input v-model="activeProvider.base_url" placeholder="https://api.openai.com/v1" spellcheck="false" />
              </div>
              <div class="field">
                <label>API Key</label>
                <input v-model="activeProvider.api_key" type="password" placeholder="sk-…" spellcheck="false" />
              </div>
              <div class="field">
                <label>默认模型</label>
                <input v-model="activeProvider.default_model" placeholder="gpt-4o-mini" spellcheck="false" />
              </div>
              <div class="field-row">
                <div class="field">
                  <label>温度</label>
                  <input v-model.number="activeProvider.temperature" type="number" step="0.1" min="0" max="2" />
                </div>
                <div class="field">
                  <label>最大 tokens</label>
                  <input v-model.number="activeProvider.max_tokens" type="number" min="1" />
                </div>
              </div>

              <div class="test-row">
                <button class="btn" :disabled="testingLlm" @click="testProvider(activeProvider)">
                  <PlugZap :size="14" />
                  <span>{{ testingLlm ? '测试中…' : '测试连接' }}</span>
                </button>
                <span v-if="llmResult[activeProvider.__key!]" class="test-res" :class="llmResult[activeProvider.__key!]!.ok ? 'ok' : 'bad'">
                  <component :is="llmResult[activeProvider.__key!]!.ok ? CheckCircle2 : XCircle" :size="14" />
                  {{ llmResult[activeProvider.__key!]!.text }}
                </span>
              </div>
              <div v-if="llmResult[activeProvider.__key!]?.detail" class="model-list">
                {{ llmResult[activeProvider.__key!]!.detail }}
              </div>

              <div class="detail-foot">
                <button class="btn" @click="saveProvider(activeProvider)"><Save :size="14" /><span>保存</span></button>
                <button
                  class="btn"
                  :disabled="!activeProvider.enabled && llmStatus[activeProvider.__key!] !== 'ok'"
                  :title="!activeProvider.enabled && llmStatus[activeProvider.__key!] !== 'ok' ? '请先用「测试连接」通过后再启用' : ''"
                  @click="toggleProviderEnabled(activeProvider)"
                >
                  <Power :size="14" /><span>{{ activeProvider.enabled ? '停用' : '启用' }}</span>
                </button>
                <button class="btn danger" @click="delProvider(activeProvider)"><Trash2 :size="14" /><span>删除</span></button>
              </div>
            </div>
            <div class="st-detail st-empty" v-else>
              <CloudOff :size="26" />
              <p>还没有 API 服务商</p>
              <span>点左侧「新增服务商」，填入 Base URL 与 API Key</span>
            </div>
          </div>
        </div>

        <!-- ============ 关于 ============ -->
        <div v-if="section === 'about'" class="st-body">
          <div class="about-card">
            <div class="about-title">节点编辑工作流 v0.2</div>
            <p class="st-desc" style="margin-top:8px">
              自建的节点式图像 / 文本工作流编辑器。三类节点：
            </p>
            <ul class="about-list">
              <li><b>本地执行</b>：文本、数值、图像（读取/缩放/拼接/模糊/尺寸）——点「运行」立即出结果，不需要 ComfyUI。</li>
              <li><b>大模型节点</b>：通过「API服务商」调用你在设置里配置的模型服务。</li>
              <li><b>扩散模型节点</b>：需要 ComfyUI 在线，按需转发（插件 comfy-executor 负责）。</li>
            </ul>
            <p class="st-desc">
              快捷键：右键画布加节点 · Ctrl+Enter 运行 · Ctrl+S 保存 · 滚轮缩放 · 中键/空白拖动平移
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  X, Plus, Save, Trash2, Check, PlugZap, CheckCircle2, XCircle, ServerOff, CloudOff, Power,
  Server, Cloud, Info
} from 'lucide-vue-next'

const emit = defineEmits<{ (e: 'close'): void; (e: 'providers-changed'): void }>()

type ComfyStatus = 'unknown' | 'ok' | 'bad'
interface Provider {
  __key?: number
  id: string
  name: string
  base_url: string
  api_key: string
  default_model: string
  enabled: boolean
  provider_type: string
  temperature: number
  max_tokens: number
}
interface ComfyCfg {
  __key?: number
  id: string
  name: string
  url: string
  is_active: boolean
}

const SECTIONS = [
  { key: 'comfy' as const, label: 'ComfyUI 连接', icon: Server },
  { key: 'llm' as const, label: 'API 服务商', icon: Cloud },
  { key: 'about' as const, label: '关于', icon: Info }
]

const section = ref<'comfy' | 'llm' | 'about'>('comfy')
const currentLabel = computed(() => SECTIONS.find((s) => s.key === section.value)?.label || '')

const providers = ref<Provider[]>([])
const comfyConfigs = ref<ComfyCfg[]>([])
let keySeq = 0
function nextKey(): number {
  keySeq += 1
  return keySeq
}

const selectedComfy = ref<number | null>(null)
const selectedProvider = ref<number | null>(null)
const comfyStatus = reactive<Record<number, ComfyStatus>>({})
const llmStatus = reactive<Record<number, ComfyStatus>>({})
const comfyResult = reactive<Record<number, { ok: boolean; text: string } | undefined>>({})
const llmResult = reactive<Record<number, { ok: boolean; text: string; detail?: string } | undefined>>({})
const testingComfy = ref(false)
const testingLlm = ref(false)

const activeComfy = computed(() => comfyConfigs.value.find((c) => c.__key === selectedComfy.value) || null)
const activeProvider = computed(() => providers.value.find((p) => p.__key === selectedProvider.value) || null)

async function load(): Promise<void> {
  const [p, c] = await Promise.all([
    (await fetch('/api/llm-providers')).json() as Promise<Provider[]>,
    (await fetch('/api/comfyui-configs')).json() as Promise<ComfyCfg[]>
  ])
  providers.value = (p || []).map((x) => ({ ...x, __key: nextKey() }))
  comfyConfigs.value = (c || []).map((x) => ({ ...x, __key: nextKey() }))
  if (!selectedComfy.value || !comfyConfigs.value.some((c2) => c2.__key === selectedComfy.value)) {
    selectedComfy.value = comfyConfigs.value[0]?.__key ?? null
  }
  if (!selectedProvider.value || !providers.value.some((p2) => p2.__key === selectedProvider.value)) {
    selectedProvider.value = providers.value[0]?.__key ?? null
  }
  // 打开面板时对已有条目做一次静默探测（只测有配置的）
  for (const cfg of comfyConfigs.value) {
    if (cfg.url && comfyStatus[cfg.__key!] === undefined) void probeComfy(cfg, true)
  }
  for (const pr of providers.value) {
    if (pr.base_url && llmStatus[pr.__key!] === undefined) void probeLlm(pr, true)
  }
}

onMounted(load)

/** 静默探测（自动刷新状态灯，不弹结果行） */
async function probeComfy(c: ComfyCfg, silent = false): Promise<void> {
  if (!c.url) { comfyStatus[c.__key!] = 'unknown'; return }
  try {
    const res = await fetch('/api/comfy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: c.url })
    })
    const d = (await res.json()) as { ok: boolean; error?: string; latency?: number; version?: string; device?: string }
    comfyStatus[c.__key!] = d.ok ? 'ok' : 'bad'
    if (!silent) {
      comfyResult[c.__key!] = {
        ok: d.ok,
        text: d.ok ? `连接正常 · ${d.latency}ms${d.version ? ` · v${d.version}` : ''}${d.device ? ` · ${d.device}` : ''}` : d.error || '连接失败'
      }
    }
  } catch (e) {
    comfyStatus[c.__key!] = 'bad'
    if (!silent) comfyResult[c.__key!] = { ok: false, text: (e as Error).message }
  }
}

async function probeLlm(p: Provider, silent = false): Promise<void> {
  if (!p.base_url) { llmStatus[p.__key!] = 'unknown'; return }
  try {
    const res = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: p.id || undefined,
        base_url: p.base_url,
        api_key: p.api_key,
        model: p.default_model
      })
    })
    const d = (await res.json()) as { ok: boolean; error?: string; latency?: number; mode?: string; models?: string[]; modelCount?: number; model?: string }
    llmStatus[p.__key!] = d.ok ? 'ok' : 'bad'
    // 连接失败却仍处于「启用」状态 → 自动停用，避免“连不上却启用”的不一致
    if (!d.ok && p.enabled) {
      p.enabled = false
      await saveProvider(p)
    }
    if (!silent) {
      llmResult[p.__key!] = {
        ok: d.ok,
        text: d.ok
          ? d.mode === 'models'
            ? `连接正常 · ${d.latency}ms · 可用模型 ${d.modelCount} 个`
            : `连接正常 · ${d.latency}ms · 模型 ${d.model || ''}`
          : d.error || '连接失败',
        detail: d.models?.length ? d.models.join('、') : undefined
      }
    }
  } catch (e) {
    llmStatus[p.__key!] = 'bad'
    if (!silent) llmResult[p.__key!] = { ok: false, text: (e as Error).message }
  }
}

async function testComfy(c: ComfyCfg): Promise<void> {
  testingComfy.value = true
  try { await probeComfy(c, false) } finally { testingComfy.value = false }
}

async function testProvider(p: Provider): Promise<void> {
  testingLlm.value = true
  try { await probeLlm(p, false) } finally { testingLlm.value = false }
}

async function saveComfy(c: ComfyCfg): Promise<void> {
  const body = { name: c.name, url: c.url, timeout: 300000, auto_connect: true }
  if (c.id) {
    await fetch(`/api/comfyui-configs/${c.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
  } else {
    await fetch('/api/comfyui-configs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
  }
  await load()
  await probeComfy(activeComfy.value || c, false)
}

async function activateComfy(c: ComfyCfg): Promise<void> {
  if (!c.id) await saveComfy(c)
  if (c.id) {
    await fetch(`/api/comfyui-configs/${c.id}/activate`, { method: 'PUT' })
    await load()
  }
}

async function delComfy(c: ComfyCfg): Promise<void> {
  if (c.id) await fetch(`/api/comfyui-configs/${c.id}`, { method: 'DELETE' })
  selectedComfy.value = null
  await load()
}

function addComfy(): void {
  const item = reactive<ComfyCfg>({ __key: nextKey(), id: '', name: '本地 ComfyUI', url: 'http://127.0.0.1:8188', is_active: false }) as ComfyCfg
  comfyConfigs.value.unshift(item)
  selectedComfy.value = item.__key!
}

async function saveProvider(p: Provider): Promise<void> {
  const body = {
    name: p.name,
    base_url: p.base_url,
    api_key: p.api_key,
    default_model: p.default_model,
    enabled: p.enabled,
    provider_type: p.provider_type || 'openai-compatible',
    temperature: p.temperature ?? 0.7,
    max_tokens: p.max_tokens ?? 4096
  }
  if (p.id) {
    await fetch(`/api/llm-providers/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
  } else {
    await fetch('/api/llm-providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
  }
  await load()
  emit('providers-changed')
  await probeLlm(activeProvider.value || p, false)
}

async function toggleProviderEnabled(p: Provider): Promise<void> {
  if (!p.enabled) {
    // 想要启用：必须测试连接通过；未通过则先自动测一次，仍不通过则禁止启用
    if (llmStatus[p.__key!] !== 'ok') {
      await testProvider(p)
      if (llmStatus[p.__key!] !== 'ok') return
    }
  }
  p.enabled = !p.enabled
  await saveProvider(p)
}

async function delProvider(p: Provider): Promise<void> {
  if (p.id) await fetch(`/api/llm-providers/${p.id}`, { method: 'DELETE' })
  selectedProvider.value = null
  await load()
  emit('providers-changed')
}

function addProvider(): void {
  const item = reactive<Provider>({
    __key: nextKey(),
    id: '',
    name: '新服务商',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    default_model: 'gpt-4o-mini',
    enabled: false,
    provider_type: 'openai-compatible',
    temperature: 0.7,
    max_tokens: 4096
  }) as Provider
  providers.value.unshift(item)
  selectedProvider.value = item.__key!
}
</script>

<style scoped>
.settings {
  display: flex;
  width: 880px;
  max-width: 94vw;
  height: 600px;
  max-height: 82vh;
  background: #17191d;
  border: 1px solid #2f343c;
  border-radius: 12px;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.62);
  overflow: hidden;
}
.st-nav {
  width: 186px;
  flex: none;
  background: #14161a;
  border-right: 1px solid #262a31;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.st-nav-title { font-size: 12.5px; font-weight: 600; color: #e6ecf4; padding: 4px 8px 10px; letter-spacing: 0.4px; }
.st-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #9aa5b3;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.st-nav-item:hover { background: #1f242b; color: #e6ecf4; }
.st-nav-item.active { background: #232c37; color: #fff; }
.st-nav-foot { margin-top: auto; font-size: 10.5px; color: #5b6472; padding: 8px; }

.st-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.st-head {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid #262a31;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
}
.x-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: transparent; border: 0; border-radius: 5px;
  color: #8b95a3; cursor: pointer;
}
.x-btn:hover { background: #2a2f37; color: #fff; }

.st-body { flex: 1; overflow-y: auto; padding: 14px 16px 18px; }
.st-desc { font-size: 12px; color: #8b95a3; line-height: 1.7; margin: 0 0 12px; }
.st-desc b { color: #cfd8e3; }

.st-split { display: flex; gap: 14px; align-items: flex-start; }
.st-list {
  width: 210px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-right: 1px solid #24282f;
  padding-right: 12px;
  min-height: 280px;
}
.st-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #b6c2d0;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.st-item:hover { background: #1f242b; }
.st-item.active { background: #222b35; border-color: #33404f; color: #fff; }
.st-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #5b6472; }
.st-dot.ok { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.7); }
.st-dot.bad { background: #ef5350; box-shadow: 0 0 6px rgba(239, 83, 80, 0.7); }
.st-tag { font-size: 9.5px; color: #7ee0a3; border: 1px solid #2c5b3f; border-radius: 4px; padding: 0 4px; flex: none; }
.st-add {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border: 1px dashed #333b45;
  border-radius: 7px;
  background: transparent;
  color: #8b95a3;
  font-size: 12px;
  cursor: pointer;
}
.st-add:hover { border-color: #3b6ea8; color: #cfe0f5; }

.st-detail { flex: 1; min-width: 0; padding-left: 2px; }
.st-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #5b6472;
  padding: 60px 10px;
  text-align: center;
}
.st-empty p { margin: 4px 0 0; color: #98a3b1; font-size: 12.5px; }
.st-empty span { font-size: 11.5px; }

.field { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.field label { width: 76px; flex: none; font-size: 12px; color: #8b95a3; }
.field input {
  flex: 1;
  min-width: 0;
  background: #1b1f25;
  border: 1px solid #2f3641;
  border-radius: 6px;
  color: #dfe6ee;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
}
.field input:focus { border-color: #3b6ea8; }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; }
.field-tip { font-size: 11px; color: #6d7683; margin: -4px 0 12px 86px; line-height: 1.6; }

.test-row { display: flex; align-items: center; gap: 10px; margin: 12px 0 6px; }
.test-res { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; }
.test-res.ok { color: #7ee0a3; }
.test-res.bad { color: #ff9b9b; }
.model-list {
  font-size: 11px;
  color: #7d8794;
  line-height: 1.6;
  background: #14171b;
  border: 1px solid #262a31;
  border-radius: 6px;
  padding: 8px 10px;
  max-height: 90px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.detail-foot {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #24282f;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #23282f;
  border: 1px solid #333a44;
  color: #cdd6e1;
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 12.5px;
  cursor: pointer;
}
.btn:hover { background: #2c333c; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.danger { color: #ff9b9b; border-color: #4a2b2b; background: #2a1c1c; }
.btn.danger:hover { background: #3a2222; }

.about-card { background: #1b1f25; border: 1px solid #2a2f37; border-radius: 10px; padding: 16px 18px; }
.about-title { font-size: 15px; font-weight: 600; color: #fff; }
.about-list { margin: 6px 0 12px; padding-left: 18px; color: #98a3b1; font-size: 12px; line-height: 1.9; }
.about-list b { color: #cfe0f5; }
</style>
