/**
 * 插件系统 —— 复刻 ComfyUI custom_nodes 机制（Node 版）
 *
 * 规则（逆向自 ComfyUI nodes.py load_custom_node / init_external_custom_nodes）：
 *  - 扫描 plugins/ 目录：单文件 plugin.js 或目录 index.js；
 *  - .disabled 后缀跳过（对应 ComfyUI 的 .disabled）；
 *  - 插件导出 NODE_CLASS_MAPPINGS（name → { def, impl }）+ NODE_DISPLAY_NAME_MAPPINGS + WEB_DIRECTORY；
 *  - 也可导出 EXECUTORS（委托执行器，如 comfy-executor）；
 *  - 内置节点不可被插件覆盖；
 *  - WEB_DIRECTORY 静态挂载到 /extensions/<插件名>/（与 ComfyUI 前端扩展路径一致）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registry } from './registry'
import { getDatabase } from './db'
import { registerExecutor } from './execution/engine'
import type { ExecutorPlugin } from './execution/engine'

export const PLUGINS_DIR = path.resolve(process.cwd(), 'plugins')

export interface PluginInfo {
  name: string
  enabled: boolean
  dir: string
  nodes: string[]
  webDir?: string
  error?: string
  hasExecutor?: boolean
}

const loaded = new Map<string, PluginInfo>()

/** 插件宿主上下文：向插件暴露只读系统能力 */
function createHostContext(): {
  getComfyConfig: () => { url: string } | null
  projectRoot: string
} {
  return {
    getComfyConfig: () => {
      try {
        const row = getDatabase()
          .prepare('SELECT url FROM comfyui_configs WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1')
          .get() as { url?: string } | undefined
        return row?.url ? { url: String(row.url).replace(/\/+$/, '') } : null
      } catch {
        return null
      }
    },
    projectRoot: process.cwd()
  }
}

function listPluginEntries(): Array<{ name: string; entry: string; dir: string; enabled: boolean }> {
  if (!fs.existsSync(PLUGINS_DIR)) return []
  const out: Array<{ name: string; entry: string; dir: string; enabled: boolean }> = []
  for (const item of fs.readdirSync(PLUGINS_DIR)) {
    if (item.startsWith('.') || item === 'README.md' || item === 'node_modules') continue
    const full = path.join(PLUGINS_DIR, item)
    let enabled = true
    let base = item
    if (item.endsWith('.disabled')) {
      enabled = false
      base = item.slice(0, -'.disabled'.length)
    }
    const st = fs.statSync(full)
    if (st.isFile() && (full.endsWith('.js') || full.endsWith('.mjs'))) {
      out.push({ name: base, entry: full, dir: PLUGINS_DIR, enabled })
    } else if (st.isDirectory()) {
      for (const cand of ['index.js', 'index.mjs', 'plugin.js', 'plugin.mjs']) {
        const p = path.join(full, cand)
        if (fs.existsSync(p)) {
          out.push({ name: base, entry: p, dir: full, enabled })
          break
        }
      }
    }
  }
  return out
}

export async function loadPlugins(): Promise<PluginInfo[]> {
  loaded.clear()
  const infos: PluginInfo[] = []
  for (const entry of listPluginEntries()) {
    if (!entry.enabled) {
      infos.push({ name: entry.name, enabled: false, dir: entry.dir, nodes: [] })
      continue
    }
    try {
      const mod = (await import(pathToFileURL(entry.entry).href + `?t=${Date.now()}`)) as Record<string, unknown>
      // 注入宿主上下文（ComfyUI 连接配置等）
      if (typeof (mod as { init?: (ctx: unknown) => void }).init === 'function') {
        ;(mod as { init: (ctx: unknown) => void }).init(createHostContext())
      }
      const result = registry.registerPlugin(entry.name, mod, entry.dir)
      const executors = (mod as { EXECUTORS?: ExecutorPlugin[] }).EXECUTORS
      if (Array.isArray(executors)) {
        for (const e of executors) registerExecutor(e)
      }
      const webDir = registry.webDirs.get(entry.name)
      const info: PluginInfo = {
        name: entry.name,
        enabled: true,
        dir: entry.dir,
        nodes: result.added > 0 ? registry.allNames().filter((n) => registry.getDef(n)?.source === `plugin:${entry.name}`) : [],
        webDir: webDir ? path.join(entry.dir, webDir) : undefined,
        hasExecutor: !!executors?.length
      }
      if (result.skipped.length) info.error = `跳过的节点（与内置重名或缺少 def）: ${result.skipped.join(', ')}`
      loaded.set(entry.name, info)
      infos.push(info)
      console.log(`[插件] ✅ ${entry.name} 加载成功（新增节点 ${result.added} 个${executors?.length ? '，含执行器' : ''}）`)
    } catch (e) {
      const info: PluginInfo = { name: entry.name, enabled: true, dir: entry.dir, nodes: [], error: String((e as Error).message || e) }
      loaded.set(entry.name, info)
      infos.push(info)
      console.error(`[插件] ❌ ${entry.name} 加载失败:`, (e as Error).message)
    }
  }
  return infos
}

export function listPlugins(): PluginInfo[] {
  return [...loaded.values()]
}

/** 从 GitHub 安装插件（git clone 到 plugins/<repo>）—— 复刻 ComfyUI-Manager repo_install */
export async function installPluginFromGit(url: string): Promise<{ ok: boolean; message: string }> {
  const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i)
  if (!m) return { ok: false, message: `无法解析 GitHub 地址: ${url}` }
  const repoName = m[2]
  const dest = path.join(PLUGINS_DIR, repoName)
  if (fs.existsSync(dest)) return { ok: false, message: `插件已存在: ${repoName}` }
  fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  const { execSync } = await import('node:child_process')
  try {
    execSync(`git clone --recursive "${url}" "${dest}"`, { stdio: 'pipe', timeout: 180000 })
    await loadPlugins()
    return { ok: true, message: `安装成功: ${repoName}` }
  } catch (e) {
    return { ok: false, message: `git clone 失败: ${(e as Error).message}` }
  }
}

/** 启用/禁用（.disabled 重命名，ComfyUI 同款） */
export async function setPluginEnabled(name: string, enabled: boolean): Promise<boolean> {
  const info = loaded.get(name)
  if (!info) return false
  const target = enabled ? path.join(PLUGINS_DIR, name) : path.join(PLUGINS_DIR, name + '.disabled')
  const src = enabled ? path.join(PLUGINS_DIR, name + '.disabled') : path.join(PLUGINS_DIR, name)
  if (!fs.existsSync(src)) return false
  if (fs.existsSync(target)) return false
  fs.renameSync(src, target)
  await loadPlugins()
  return true
}

/** 卸载（仅限 plugins/ 目录内） */
export async function uninstallPlugin(name: string): Promise<boolean> {
  const dir = path.join(PLUGINS_DIR, name)
  const dirDisabled = path.join(PLUGINS_DIR, name + '.disabled')
  const target = fs.existsSync(dir) ? dir : dirDisabled
  if (!fs.existsSync(target) || !target.startsWith(PLUGINS_DIR)) return false
  fs.rmSync(target, { recursive: true, force: true })
  await loadPlugins()
  return true
}
