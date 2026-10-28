/**
 * 节点工厂 —— 把 /object_info schema 动态编译成 LiteGraph 节点类
 * 规则（对应 ComfyUI 前端 widgetRegistry + 连接规则）：
 *  - 输入端口：required + optional 按 input_order 顺序，左输入右输出；
 *  - 可控件化类型（INT/FLOAT/STRING/BOOLEAN/COMBO/COLOR/IMAGEUPLOAD/seed）同时创建端口+控件；
 *  - 连线接通 → 控件变暗（widget.disabled），执行时连线值优先；
 *  - INT+control_after_generate → seed 三态控件；STRING+multiline → 多行文本；
 *  - 输出节点（output_node）带结果显示控件（图片/文本/聊天）。
 */
import { LGraphNode, LiteGraph } from 'litegraph.js'
import { slotColor } from './litegraphSetup'
import {
  DOMWidget,
  createNumberWidget,
  createSliderWidget,
  createTextWidget,
  createComboWidget,
  createComboUploadWidget,
  createToggleWidget,
  createColorWidget,
  createUploadWidget,
  createSeedWidget,
  createImagePreviewWidget,
  createImageThumbWidget,
  createTextDisplayWidget,
  createChatWidget,
  createProviderWidget,
  attachWidget
} from './widgets'

/** 前端本地 schema 类型（与后端 registry/types.ts 对应） */
export interface FrontNodeDef {
  input: {
    required?: Record<string, [string | string[], Record<string, unknown>]>
    optional?: Record<string, [string | string[], Record<string, unknown>]>
  }
  output: string[]
  output_name: string[]
  name: string
  display_name: string
  description: string
  category: string
  output_node: boolean
  native?: boolean
  /** 与 native 版重复的官方同名节点：不在节点库/搜索里列出 */
  hidden?: boolean
  deprecated?: boolean
  experimental?: boolean
}

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COLOR', 'IMAGEUPLOAD'])

export interface NodeCallbacks {
  /** 输出节点执行完成后更新显示控件 */
  onNodeOutput?: (nodeId: number, nodeType: string, output: unknown) => void
  /** 聊天节点发送消息 */
  onChatSend?: (nodeId: number, message: string) => void
  /** API 服务商节点请求刷新服务商列表 */
  onRefreshProviders?: () => void
}

/** 端口槽的运行时形态：LiteGraph 的 ISlot 加上我们挂的控件绑定字段 */
interface SlotLike {
  name: string
  type?: string
  link?: number | null
  widget?: DOMWidget
  label?: string
  color_on?: string
  color_off?: string
  __linked?: boolean
}

const registeredTypes = new Set<string>()

export function registerNodeType(def: FrontNodeDef, cb: NodeCallbacks = {}): typeof LGraphNode {
  if (registeredTypes.has(def.name)) return LGraphNode as never
  registeredTypes.add(def.name)

  const inputGroups = def.input || {}
  const inputOrder: string[] = []
  for (const key of ['required', 'optional'] as const) {
    const g = inputGroups[key]
    if (g) inputOrder.push(...Object.keys(g))
  }

  class DynamicNode extends LGraphNode {
    static title = def.display_name || def.name
    static desc = def.description
    widgets: DOMWidget[] = []
    /** 输出显示控件引用 */
    outputWidget?: { setValue: (v: unknown) => void }
    /** 输入图像缩略图（LoadImage） */
    imageThumb?: { setValue: (f: string) => void }
    chatWidget?: { setHistory: (m: Array<{ role: string; content: string }>) => void; onSend: (fn: (m: string) => void) => void }

    constructor() {
      super()
      this.title = def.display_name || def.name
      this.type = def.name

      // ---- 输入端口 + 控件 ----
      for (const name of inputOrder) {
        const group = inputGroups.required?.[name] ? inputGroups.required : inputGroups.optional
        // ComfyUI 的输入声明有两种形态：
        //   ['IMAGE']                      ← 没有配置对象（如 PreviewImage 的 images）
        //   ['INT', { default: 1, ... }]   ← 带配置对象
        // 之前直接把 spec[1] 当对象用，遇到第一种就会在读取 cfg.forceInput 时抛异常，
        // 整个节点构造函数失败 → LiteGraph 降级成裸 LGraphNode（无标题、无控件、无端口），
        // 表现就是「官方节点全都是坏的」。这里统一兜底成空对象。
        const spec = (group?.[name] as unknown[]) || []
        const rawType = (spec[0] as string | string[]) ?? '*'
        const cfg = (spec[1] as Record<string, unknown>) || {}
        const type = Array.isArray(rawType) ? rawType.join(',') : rawType
        this.addInput(name, type)

        const isCombo = Array.isArray(rawType) || type === 'COMBO'
        // forceInput：该输入只提供端口，不生成控件（ComfyUI 同款规则）。
        // 例如「文本显示」的 text 输入，之前会多出一个单行输入框，看起来像"只有一行"。
        if (cfg.forceInput) continue
        if (!isCombo && !WIDGET_TYPES.has(type)) continue // 纯端口输入（MODEL/CLIP/LATENT...）
        if (isCombo) {
          // combo：数组类型
          const options = Array.isArray(rawType) ? rawType : ((cfg.options as string[]) || [])
          const initial = (cfg.default as string) ?? options[0] ?? ''
          // API 服务商：专用控件（实时读取设置里的服务商，带类型/模型/启用状态与刷新）
          if (def.name === 'ApiProvider') {
            const { widget, setDisabled, setValue } = createProviderWidget(name, initial, {
              onRefresh: () => cb.onRefreshProviders?.()
            })
            attachWidget(this, widget, setDisabled)
            ;(widget as unknown as { setValue: (v: string) => void }).setValue = setValue
            this.linkSlotWidget(name, widget)
            continue
          }
          if (cfg.image_upload) {
            // LoadImage 类节点：下拉（已有图片）+ 上传按钮 + 缩略图（复刻 ComfyUI 原生形态）
            let thumb: { widget: DOMWidget; setValue: (f: string) => void } | null = null
            const { widget, setDisabled, setValue } = createComboUploadWidget(name, initial, options as string[], {
              onChange: (v) => thumb?.setValue(v)
            })
            attachWidget(this, widget, setDisabled)
            ;(widget as unknown as { setValue: (v: string) => void }).setValue = setValue
            this.linkSlotWidget(name, widget)
            thumb = createImageThumbWidget('__thumb__')
            attachWidget(this, thumb.widget)
            this.imageThumb = thumb
            thumb.setValue(initial)
            continue
          }
          const { widget, setDisabled } = createComboWidget(name, initial, options as string[])
          attachWidget(this, widget, setDisabled)
          this.linkSlotWidget(name, widget)
          continue
        }
        if (type === 'IMAGEUPLOAD') {
          const { widget, setDisabled, setValue } = createUploadWidget(name, null)
          attachWidget(this, widget, setDisabled)
          ;(widget as unknown as { setValue: (v: { filename: string } | null) => void }).setValue = setValue
          this.linkSlotWidget(name, widget)
          continue
        }
        if (type === 'BOOLEAN') {
          const { widget, setDisabled } = createToggleWidget(name, !!cfg.default)
          attachWidget(this, widget, setDisabled)
          this.linkSlotWidget(name, widget)
          continue
        }
        if (type === 'COLOR') {
          const { widget, setDisabled } = createColorWidget(name, (cfg.default as string) || '#000000')
          attachWidget(this, widget, setDisabled)
          this.linkSlotWidget(name, widget)
          continue
        }
        if (type === 'STRING') {
          const { widget, setDisabled } = createTextWidget(name, (cfg.default as string) ?? '', { multiline: !!cfg.multiline })
          attachWidget(this, widget, setDisabled)
          this.linkSlotWidget(name, widget)
          continue
        }
        if (type === 'INT') {
          if (cfg.display === 'color') {
            // 例如 EmptyImage 的 color：INT 存储 0xRRGGBB，界面用取色器
            const { widget, setDisabled } = createColorWidget(name, cfg.default as number, { asInt: true })
            attachWidget(this, widget, setDisabled)
            this.linkSlotWidget(name, widget)
            continue
          }
          if (cfg.control_after_generate) {
            const { widget, setDisabled } = createSeedWidget(name, (cfg.default as number) ?? 0, {
              min: cfg.min as number,
              max: cfg.max as number
            })
            attachWidget(this, widget, setDisabled)
            this.linkSlotWidget(name, widget)
          } else {
            const { widget, setDisabled } = createNumberWidget(name, (cfg.default as number) ?? 0, {
              min: cfg.min as number,
              max: cfg.max as number,
              step: cfg.step as number
            })
            attachWidget(this, widget, setDisabled)
            this.linkSlotWidget(name, widget)
          }
          continue
        }
        if (type === 'FLOAT') {
          if (cfg.step && cfg.min !== undefined && cfg.max !== undefined && cfg.display === 'slider') {
            const { widget, setDisabled } = createSliderWidget(name, (cfg.default as number) ?? 0, {
              min: cfg.min as number,
              max: cfg.max as number,
              step: cfg.step as number
            })
            attachWidget(this, widget, setDisabled)
            this.linkSlotWidget(name, widget)
          } else {
            const { widget, setDisabled } = createNumberWidget(name, (cfg.default as number) ?? 0, {
              min: cfg.min as number,
              max: cfg.max as number,
              step: (cfg.step as number) ?? 0.1
            })
            attachWidget(this, widget, setDisabled)
            this.linkSlotWidget(name, widget)
          }
          continue
        }
      }

      // ---- 输出端口 ----
      const outTypes = def.output || []
      const outNames = def.output_name || []
      outTypes.forEach((t, i) => {
        this.addOutput(outNames[i] || t, t)
      })

      // ---- 输出节点显示控件 ----
      if (def.output_node) {
        this.setupOutputWidget()
      }

      // ---- 端口颜色（ComfyUI：端口按类型着色）----
      this.colorizePorts()

      // 默认尺寸：宽 220，高度按「端口行带 + 组件行」估算；新拖入节点在 ComfyGraph.addNode 里会再保证 2:3 宽高比
      // 端口行带 = max(最后一个纯输入端口的行下标 + 1, 输出行数)——输入输出共用同一条垂直栅格
      const slotH = LiteGraph.NODE_SLOT_HEIGHT || 26
      let lastInRow = -1
      ;(this.inputs || []).forEach((s, i) => {
        if (!(s as unknown as { widget?: unknown }).widget) lastInRow = i
      })
      const socketRows = Math.max(lastInRow + 1, (this.outputs || []).length)
      const estH =
        8 +
        socketRows * slotH +
        this.widgets.reduce((sum, w) => sum + (w.options?.minHeight || w.options?.height || 22) + 3, 0) +
        6
      this.size = [Math.max(220, this.size?.[0] || 220), Math.max(80, estH)]

      this.onConnectionsChange = () => this.refreshWidgetStates()
      this.refreshWidgetStates()
      ;(this as unknown as { onResize?: (size: number[]) => void }).onResize = (size: number[]) => {
        // 缩放下限：宽度要放得下「名称 + 控件」，高度要放得下所有控件（无上限）
        const minW = this.widgets.length ? 200 : 140
        const meta = this as unknown as { __minH?: number }
        const minH = Math.max(64, meta.__minH || 80)
        if (size[0] < minW) size[0] = minW
        if (size[1] < minH) size[1] = minH
      }
    }

    /**
     * litegraph 在 configure 末尾回调本方法。
     * 它在此之前执行了 `this.inputs = LiteGraph.cloneObject(info.inputs)` —— 序列化只存
     * name/type/link，于是构造函数里绑好的 slot.widget、slot.label='' 、透明端口色被整体冲掉。
     * 症状：组件行下面又冒出一排纯端口行、连线端点回落到顶部端口列、连线后控件不置灰。
     * 这里按「控件名 == 输入名」把绑定重新装回去（控件名就是 ComfyUI 的输入名）。
     */
    onConfigure(info: unknown): void {
      const slots = (this.inputs || []) as unknown as SlotLike[]
      let changed = false
      for (const w of this.widgets) {
        if (!w?.name || w.name.startsWith('__')) continue
        const slot = slots.find((s) => s.name === w.name)
        if (!slot) continue
        if (slot.widget !== w) {
          slot.widget = w
          changed = true
        }
        if (slot.label !== '') {
          slot.label = ''
          changed = true
        }
        slot.color_on = 'transparent'
        slot.color_off = 'transparent'
      }
      this.colorizePorts()
      // 基类按 1:1 下标灌 widgets_values，遇到「一控件多槽位」（seed = 种子 + 生成后控制）会错位，
      // 这里按 valueSlots 重新走一遍游标。
      const vals = (info as { widgets_values?: unknown[] } | undefined)?.widgets_values
      if (Array.isArray(vals) && vals.length) {
        let cursor = 0
        for (const w of this.widgets) {
          if (cursor >= vals.length) break
          w.value = vals[cursor]
          const n = Math.max(1, w.valueSlots || 1)
          if (n > 1) w.setExtraValues?.(vals.slice(cursor + 1, cursor + n))
          cursor += n
        }
      }
      // 值已写进 widget.value，同步到 DOM（否则界面还显示默认值）
      for (const w of this.widgets) w.syncDom?.()
      this.refreshWidgetStates()
      if (changed) this.setDirtyCanvas?.(true, true)
    }

    /** 与 onConfigure 对称：序列化时按 valueSlots 展开（seed 写回 [种子, 模式]） */
    onSerialize(o: unknown): void {
      const target = o as { widgets_values?: unknown[] }
      if (!Array.isArray(target.widgets_values)) return
      const out: unknown[] = []
      for (const w of this.widgets) {
        out.push(w.value ?? null)
        const extra = w.getExtraValues?.()
        if (extra?.length) out.push(...extra)
      }
      target.widgets_values = out
    }

    /** 控件可用态：被忽略(bypass) 或已用连线取值时置灰失效（ComfyUI 同款） */
    refreshWidgetStates(): void {
      const bypassed = Number(this.mode ?? 0) === 4
      for (const w of this.widgets) {
        const slot = this.inputs?.find((s) => (s as unknown as { widget?: DOMWidget }).widget === w)
        const linked = !!slot && slot.link != null
        const setDisabled = (w as unknown as { setDisabled?: (d: boolean) => void }).setDisabled
        setDisabled?.(bypassed || linked)
        if (slot) (slot as unknown as { __linked?: boolean }).__linked = linked
      }
      this.setDirtyCanvas?.(true, true)
    }

    /** 被忽略的节点：虚线边框 + 斜纹 + 「已忽略」角标（一眼能看出来它不参与运算） */
    onDrawForeground(ctx: CanvasRenderingContext2D): void {
      if (Number(this.mode ?? 0) !== 4) return
      const w = this.size[0]
      const h = this.size[1]
      const titleH = LiteGraph.NODE_TITLE_HEIGHT || 30
      ctx.save()
      // 斜纹遮罩
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.clip()
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = -h; x < w; x += 10) {
        ctx.moveTo(x, h)
        ctx.lineTo(x + h, 0)
      }
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.strokeStyle = 'rgba(240,170,80,0.85)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([7, 4])
      ctx.beginPath()
      ctx.rect(0.5, -titleH + 0.5, w - 1, h + titleH - 1)
      ctx.stroke()
      ctx.setLineDash([])
      // 角标
      const label = '已忽略'
      ctx.font = '11px "Microsoft YaHei", sans-serif'
      const tw = ctx.measureText(label).width + 12
      const bx = w - tw - 6
      const by = -titleH + 5
      ctx.fillStyle = 'rgba(28,22,12,0.94)'
      ctx.strokeStyle = 'rgba(240,170,80,0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(bx, by, tw, 17)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ffc978'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + tw / 2, by + 9)
      ctx.restore()
    }

    private linkSlotWidget(name: string, widget: DOMWidget): void {
      const slot = this.inputs?.find((s) => s.name === name) as unknown as SlotLike | undefined
      if (!slot) return
      slot.widget = widget
      // ComfyUI 1.x：有组件的输入不再单独占一行端口——组件行本身就是它的端口。
      // 做法：标签置空 + 端口点透明（保留几何位置用于命中/连线），
      // 位置由 getConnectionPos 挪到组件行左侧，鼠标划过组件时才由 DOM 浮现圆点。
      slot.label = ''
      slot.color_on = 'transparent'
      slot.color_off = 'transparent'
    }

    /**
     * 组件化输入的连线端点 = 该组件行的左侧中心（而不是顶部端口列）。
     * litegraph 画线/命中都走这个方法，所以连线会精确落在组件行上。
     */
    getConnectionPos(is_input: boolean, slot: number | string, out?: [number, number]): [number, number] {
      const pos = super.getConnectionPos(is_input, slot, out) as unknown as [number, number]
      if (!is_input) return pos
      const idx = typeof slot === 'number' ? slot : (this.inputs || []).findIndex((s) => s.name === slot)
      const s = idx >= 0 ? ((this.inputs || [])[idx] as unknown as { widget?: DOMWidget }) : undefined
      const w = s?.widget
      if (!w || w.last_y == null) return pos
      const size = w.computeSize ? w.computeSize(this.size[0]) : [0, 22]
      const rowH = Math.min(size?.[1] || 22, 30)
      // 落点 = 胶囊行左边缘（内缩 8px，与 patchCanvas 的 INSET 一致），而不是 litegraph 默认的 13px
      pos[0] = this.pos[0] + 8
      pos[1] = this.pos[1] + (w.last_y || 0) + rowH / 2
      return pos
    }

    private colorizePorts(): void {
      const paint = (slots?: Array<{ type: string; color_on?: string; color_off?: string; widget?: unknown }>) => {
        if (!slots) return
        for (const s of slots) {
          // 有组件的输入不画端口点（组件行自己就是端口，见 linkSlotWidget）
          if (s.widget) {
            s.color_on = 'transparent'
            s.color_off = 'transparent'
            continue
          }
          const c = slotColor(s.type)
          s.color_on = c
          s.color_off = c
        }
      }
      paint(this.inputs as never)
      paint(this.outputs as never)
    }

    private setupOutputWidget(): void {
      // 聊天节点
      if (def.name.includes('Chat')) {
        const { widget, setHistory, onSend } = createChatWidget('__chat__')
        this.widgets.push(widget)
        this.chatWidget = { setHistory, onSend }
        onSend((msg) => cb.onChatSend?.(this.id, msg))
        return
      }
      // 图像输出节点：输出里带 IMAGE，或名字里含 Image/图像
      const hasImageOutput = (def.output || []).includes('IMAGE')
      if (hasImageOutput || /image|图像/i.test(def.name)) {
        const { widget, setValue } = createImagePreviewWidget('__output__')
        this.widgets.push(widget)
        this.outputWidget = { setValue }
        return
      }
      // 其余输出节点（文本显示 / 数值显示）→ 文本展示框
      const { widget, setValue } = createTextDisplayWidget('__output__')
      this.widgets.push(widget)
      this.outputWidget = { setValue }
    }

    /** litegraph 标准钩子：节点被移除/清空时调用（注意是 onRemoved 不是 onRemove） */
    onRemoved(): void {
      for (const w of this.widgets) w.onRemove?.()
    }

    /** 执行高亮（ComfyUI：执行中节点边框变蓝，结束后回默认色） */
    setExecuting(active: boolean): void {
      ;(this as unknown as { __executing?: boolean }).__executing = active
      this.boxcolor = active ? '#6ea8e8' : '#6b7280'
      ;(this as unknown as { _dirty: boolean })._dirty = true
    }
  }

  // 同名类型可能已经被 baseNodes.json 注册过一次（官方节点名），
  // 直接覆盖时 litegraph 只会打一行 "replacing node type"，但旧注册里残留的
  // Nodes[classname] 会让 createNode 拿到旧基类 → 节点无标题无控件。先注销再注册最干净。
  const existing = (LiteGraph as unknown as { registered_node_types?: Record<string, unknown> })
    .registered_node_types?.[def.name]
  if (existing) {
    try {
      LiteGraph.unregisterNodeType(def.name)
    } catch {
      /* 忽略：类型残留不影响覆盖注册 */
    }
  }

  LiteGraph.registerNodeType(def.name, DynamicNode)
  return DynamicNode
}

export function createNodeOfType(type: string): LGraphNode | null {
  return LiteGraph.createNode(type) as LGraphNode | null
}
