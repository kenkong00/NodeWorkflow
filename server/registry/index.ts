/**
 * 节点注册表 —— 复刻 ComfyUI NODE_CLASS_MAPPINGS 机制
 *
 * 规则（逆向自 ComfyUI nodes.py init_external_custom_nodes）：
 *  1. 内置基础节点（434 个，从本机 ComfyUI v0.9.2 真机导出）首先注册；
 *  2. 原生 TS 实现注册（可执行节点）；
 *  3. 插件后注册，插件不能覆盖内置节点名（ignore 集合）；
 *  4. /object_info 输出与 ComfyUI 完全一致的格式，前端零适配。
 */
import baseNodesJson from './baseNodes.json'
import type { NodeDef, NativeNodeImpl } from './types'

export class NodeRegistry {
  private defs = new Map<string, NodeDef>()
  private impls = new Map<string, NativeNodeImpl>()
  /** 插件 Web 扩展目录：name -> 绝对路径（对应 ComfyUI EXTENSION_WEB_DIRS） */
  readonly webDirs = new Map<string, string>()
  /** 插件模块目录（用于更新/卸载） */
  readonly pluginDirs = new Map<string, string>()

  constructor() {
    for (const [name, def] of Object.entries(baseNodesJson as unknown as Record<string, NodeDef>)) {
      this.defs.set(name, { ...def, name, source: 'builtin' })
    }
  }

  /** 内置节点名集合（插件不可覆盖，ComfyUI ignore 规则） */
  get baseNames(): string[] {
    return [...this.defs.keys()].filter((n) => this.defs.get(n)!.source === 'builtin')
  }

  has(name: string): boolean {
    return this.defs.has(name)
  }

  getDef(name: string): NodeDef | undefined {
    return this.defs.get(name)
  }

  getImpl(name: string): NativeNodeImpl | undefined {
    return this.impls.get(name)
  }

  hasNativeImpl(name: string): boolean {
    return this.impls.has(name)
  }

  /** 注册原生实现 */
  registerImpl(name: string, impl: NativeNodeImpl): void {
    this.impls.set(name, impl)
    const def = this.defs.get(name)
    if (def) def.native = true
  }

  /** 注册一个全新节点定义（内置或插件） */
  registerDef(def: NodeDef, opts: { allowOverride?: boolean } = {}): boolean {
    const existing = this.defs.get(def.name)
    if (existing && !opts.allowOverride) {
      if (existing.source === 'builtin') return false // 内置节点不可覆盖
    }
    this.defs.set(def.name, def)
    return true
  }

  /**
   * 加载插件导出的节点（ComfyUI V1 风格）
   * plugin.js 导出：{ NODE_CLASS_MAPPINGS: {name: {def, impl?}}, NODE_DISPLAY_NAME_MAPPINGS?, WEB_DIRECTORY? }
   */
  registerPlugin(pluginName: string, mod: Record<string, unknown>, pluginDir: string): { added: number; skipped: string[] } {
    const added = { added: 0, skipped: [] as string[] }
    this.pluginDirs.set(pluginName, pluginDir)

    const webDir = (mod as { WEB_DIRECTORY?: string }).WEB_DIRECTORY
    if (webDir) {
      this.webDirs.set(pluginName, webDir)
    }

    const mappings = (mod as { NODE_CLASS_MAPPINGS?: Record<string, unknown> }).NODE_CLASS_MAPPINGS
    if (mappings) {
      for (const [name, entry] of Object.entries(mappings)) {
        const def = (entry as { def?: NodeDef }).def
        if (!def) {
          added.skipped.push(name)
          continue
        }
        const full: NodeDef = { ...def, name, source: `plugin:${pluginName}`, native: true }
        if (this.registerDef(full)) {
          added.added++
          const impl = (entry as { impl?: NativeNodeImpl }).impl
          if (impl) this.registerImpl(name, impl)
        } else {
          added.skipped.push(name)
        }
      }
    }

    const displayNames = (mod as { NODE_DISPLAY_NAME_MAPPINGS?: Record<string, string> }).NODE_DISPLAY_NAME_MAPPINGS
    if (displayNames) {
      for (const [name, dn] of Object.entries(displayNames)) {
        const def = this.defs.get(name)
        if (def) def.display_name = dn
      }
    }
    return added
  }

  /** /object_info（与 ComfyUI 输出格式一致） */
  objectInfo(): Record<string, NodeDef> {
    const out: Record<string, NodeDef> = {}
    for (const [name, def] of this.defs) out[name] = def
    return out
  }

  allNames(): string[] {
    return [...this.defs.keys()]
  }

  /** 分类树：category -> names（category 支持 a/b 分级） */
  categoryTree(): Array<{ category: string; nodes: Array<{ name: string; display_name: string; native: boolean }> }> {
    const map = new Map<string, Array<{ name: string; display_name: string; native: boolean }>>()
    for (const def of this.defs.values()) {
      const cat = def.category || 'sd'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push({ name: def.name, display_name: def.display_name || def.name, native: !!def.native })
    }
    return [...map.entries()]
      .map(([category, nodes]) => ({ category, nodes: nodes.sort((a, b) => a.display_name.localeCompare(b.display_name)) }))
      .sort((a, b) => a.category.localeCompare(b.category))
  }
}

export const registry = new NodeRegistry()
