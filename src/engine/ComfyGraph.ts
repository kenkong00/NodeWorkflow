/**
 * ComfyGraph —— ComfyUI 同款画布管理器
 *  - LiteGraph 引擎封装 + DOM 控件定位（覆写 drawNodeWidgets）
 *  - ComfyUI 工作流格式序列化/反序列化（nodes/links/widgets_values）
 *  - 执行高亮 / 小地图 / 右键菜单 / 双击加节点
 */
import { LGraph, LGraphCanvas, LiteGraph, LGraphNode } from 'litegraph.js'
import { configureLiteGraph, slotColor } from './litegraphSetup'
import { registerNodeType, createNodeOfType, type FrontNodeDef, type NodeCallbacks } from './nodeFactory'
import { DOMWidget, setProviderList } from './widgets'
import { NV, GROUP_HEADER_H } from './nodeDraw'

export interface WorkflowNodeJSON {
  id: number
  type: string
  pos: [number, number]
  size: [number, number]
  flags: Record<string, unknown>
  order: number
  mode: number
  inputs: Array<{ name: string; type: string; link: number | null }>
  outputs: Array<{ name: string; type: string; links: number[]; slot_index: number }>
  properties: Record<string, unknown>
  widgets_values: unknown[]
}

export interface WorkflowJSON {
  last_node_id: number
  last_link_id: number
  nodes: WorkflowNodeJSON[]
  links: Array<[number, number, number, number, number, string]>
  [k: string]: unknown
}

/**
 * litegraph d.ts 把 LGraph._nodes 标为 private，运行时是公开字段且无替代遍历 API。
 * 统一走此访问器取全部节点（id → node）。
 */
function nodesOf(g: LGraph): Record<number, LGraphNode> {
  return (g as unknown as { _nodes: Record<number, LGraphNode> })._nodes
}

/** 每帧布局时记录的元信息（供缩放下限、隐藏端口命中使用） */
interface NodeLayoutMeta {
  /** 内容所需最小高度（控件排布完后的真实值） */
  __minH?: number
  /** 组件行（组件 ↔ 输入端口对应） */
  __rows?: Array<{ widget: unknown; slot: { type: string | number; link: number | null }; y: number; h: number }>
}

/** 端口类型是否兼容（`*` 通配、逗号分隔多类型） */
function typesCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  if (a === '*' || b === '*') return true
  const A = a.split(',').map((s) => s.trim())
  const B = b.split(',').map((s) => s.trim())
  return A.some((x) => B.includes(x))
}

/** 节点/组右键菜单请求（Vue 层渲染菜单，比 litegraph 原生菜单可控） */
export interface NodeMenuRequest {
  kind: 'node' | 'group'
  clientX: number
  clientY: number
  nodeId: number
  title: string
  /** 已忽略（bypass） */
  bypassed: boolean
  collapsed: boolean
  /** 当前标题栏颜色（未自定义为 null） */
  color: string | null
  /** 打开菜单时的意图：rename = 直接进入重命名输入 */
  intent?: 'rename'
  /** 本次操作影响的节点（多选时是全部选中节点，右键的那一个是 primary） */
  targets: number[]
  /** 组菜单：组 id / 组内节点数 / 组标题 */
  groupId?: number
  groupTitle?: string
  groupNodes?: number
  /** 组内节点是否全部已忽略（用于菜单显示「取消忽略」） */
  groupBypassed?: boolean
}

/** 右键菜单动作（Vue 菜单 → 画布 API 的统一载荷） */
export interface MenuAction {
  type: 'delete' | 'bypass' | 'unbypass' | 'collapse' | 'clone' | 'color' | 'select' | 'fit' | 'ungroup' | 'deleteAll' | 'group'
  color?: string | null
}

/** 组（对应 litegraph LGraphGroup，兼容旧工作流的 groups 字段） */
export interface GroupHandle {
  __gid: number
  __accent?: string
  title: string
  _pos: Float32Array
  _size: Float32Array
  _nodes: LGraphNode[]
  _bounding: Float32Array
  recomputeInsideNodes: () => void
  setDirtyCanvas?: (f: boolean, b: boolean) => void
}

export interface SearchBoxFilter {
  /** 鼠标屏幕坐标（浮层定位） */
  clientX: number
  clientY: number
  /** 画布坐标（节点落点） */
  canvasX: number
  canvasY: number
  /** 从端口拖出时：来源节点/端口/类型 */
  fromNodeId?: number
  fromSlot?: number
  fromType?: string
  /** true=从输出端口拖出（找有此输入的节点）；false=从输入端口拖出（找有此输出的节点） */
  fromOutput?: boolean
}

export class ComfyGraph {
  graph: LGraph
  canvas: LGraphCanvas
  private host: HTMLElement
  private domLayer: HTMLElement
  private minimap: HTMLCanvasElement | null = null
  private minimapCtx: CanvasRenderingContext2D | null = null
  private cb: NodeCallbacks
  /** 打开搜索浮层的回调（由 Vue 层注入）——ComfyUI 同款：右键/双击/拖线到空白均触发 */
  onOpenSearchBox: ((filter: SearchBoxFilter) => void) | null = null
  /** 拖入 .json 工作流文件（由 Vue 层解析后加载） */
  onDropWorkflowFile: ((file: File) => void) | null = null
  /** 拖入图片文件（Vue 层上传后回填到节点或新建 LoadImage） */
  onDropImageFile: ((file: File, pos: [number, number], hitNodeId: number | null) => void) | null = null
  /** 右键节点 → 打开自定义节点菜单 */
  onNodeContextMenu: ((req: NodeMenuRequest) => void) | null = null
  /** 图内容变化（节点增删/连线/移动/改值）—— 供标签页标记"未保存" */
  onChange: (() => void) | null = null
  private suppressChange = false
  private changeTimer = 0
  private renderRaf = 0
  private destroyed = false
  private resizeObserver: ResizeObserver | null = null
  /** 自定义缩放手柄：当前悬停/正在缩放的节点 */
  private hoverResizeId: number | null = null
  private resizeState: { node: LGraphNode; startX: number; startY: number; startW: number; startH: number } | null = null

  constructor(host: HTMLElement, cb: NodeCallbacks = {}) {
    this.host = host
    this.cb = cb
    configureLiteGraph()
    this.patchCanvas()
    // 必须在 new LGraphCanvas 之前覆写：其构造函数里 processMouseUp.bind(this)
    // 会固化当前原型方法，晚于它的 patch 不会生效（拖线到空白弹搜索依赖此覆写）。
    this.patchProcessMouseUp()

    this.graph = new LGraph()
    this.domLayer = document.createElement('div')
    this.domLayer.style.position = 'absolute'
    this.domLayer.style.inset = '0'
    this.domLayer.style.pointerEvents = 'none'
    this.domLayer.style.zIndex = '5'
    this.domLayer.style.overflow = 'hidden'
    host.appendChild(this.domLayer)

    const canvasEl = document.createElement('canvas')
    canvasEl.tabIndex = 0
    host.appendChild(canvasEl)

    this.canvas = new LGraphCanvas(canvasEl, this.graph, {
      autoresize: true,
      background_image: null,
      render_shadows: false,
      title_text: ''
    } as never)
    // DOM 控件层挂到画布实例上（drawNodeWidgets 覆写里读取）
    ;(this.canvas as unknown as { __domLayer?: HTMLElement }).__domLayer = this.domLayer
    // 拖拽遮罩：拖动节点时盖在「下方节点」的 DOM 控件之上，消除「透过拖拽节点看到下面控件」的观感。
    // 根因：DOM 控件层整体浮在画布之上，下面节点的控件是 DOM、永远画在画布里的拖动节点底色之上，
    // 所以会透出来。用一块与节点同色的 DOM 遮罩压住它们即可，标题栏仍由画布绘制（不被遮罩，保留节点辨识度）。
    const dragCover = document.createElement('div')
    dragCover.className = 'comfy-drag-cover'
    dragCover.style.position = 'absolute'
    dragCover.style.left = '0'
    dragCover.style.top = '0'
    dragCover.style.display = 'none'
    dragCover.style.pointerEvents = 'none'
    // 完全复刻 drawNodeShape 的 body 外观：下圆角 9px + 拖拽时鼠标在节点上 → hover 描边
    dragCover.style.borderRadius = '0 0 9px 9px'
    dragCover.style.boxSizing = 'border-box'
    dragCover.style.border = `1px solid ${NV.nodeBorderHover}`
    dragCover.style.zIndex = '50000'
    this.domLayer.appendChild(dragCover)
    ;(this.canvas as unknown as { __dragCover?: HTMLElement }).__dragCover = dragCover
    this.canvas.allow_searchbox = false // 用我们自己的 Vue 搜索对话框
    this.canvas.allow_dragcanvas = true
    // 端口名称字体（数字 + 中文都清晰，跟 ComfyUI 一致）
    ;(this.canvas as unknown as { inner_text_font: string }).inner_text_font =
      'normal 12.5px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
    ;(this.canvas as unknown as { title_text_font: string }).title_text_font =
      '13px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
    this.canvas.links_render_mode = LiteGraph.SPLINE_LINK
    ;(this.canvas as unknown as { round_radius: number }).round_radius = 9
    ;(this.canvas as unknown as { skip_events: boolean }).skip_events = false
    // 关掉 litegraph 自带的画布边框：它按「图坐标 0,0 起、画布像素大小」画矩形，
    // 缩放后会在画面中间留下一个浅色大框（用户反馈的"浅浅的绿色的框"）。
    ;(this.canvas as unknown as { render_canvas_border: boolean }).render_canvas_border = false
    ;(this.canvas as unknown as { clear_background_color: string | null }).clear_background_color = null
    // 隐藏左下角 litegraph 自带的 T/I/N/FPS 信息块（ComfyUI 也没有它，且会压住节点库）
    ;(this.canvas as unknown as { show_info: boolean }).show_info = false

    this.setupMenus()
    this.setupDblClick()
    this.setupFileDrop()
    this.setupChangeTracking()
    this.setupResizeHandle()
    this.patchIsOverNodeInput()
    this.patchSelection()
    this.setupPortDrag()
    // 拖线到空白松手 → 弹搜索框（实例级桥接，供原型覆写读取）
    ;(this.canvas as unknown as { __onSearchBoxFromLink?: (f: SearchBoxFilter) => void }).__onSearchBoxFromLink =
      (f) => this.onOpenSearchBox?.(f)
    this.graph.start()
    // 原生 litegraph 0.7.18 无内置渲染循环（ComfyUI fork 才有），需自行驱动 draw；
    // autoresize 仅在 processMouseMove 内触发，故首帧手动 resize 到容器尺寸。
    this.canvas.resize(host.clientWidth || 800, host.clientHeight || 600)
    this.startRenderLoop()
    // 容器尺寸变化（窗口缩放、侧栏折叠）→ 同步 canvas
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.canvas.resize(this.host.clientWidth, this.host.clientHeight)
      })
      this.resizeObserver.observe(host)
    }
    // 调试/自动化钩子（无 UI 副作用）
    ;(window as unknown as { __comfyGraph?: ComfyGraph }).__comfyGraph = this
    // 命中自检（防御：画布被浮层遮挡时真实鼠标会全部失效）
    this.verifyCanvasHittable()
  }

  /** rAF 渲染循环（ComfyUI 同款：每帧 draw，litegraph 内部按 dirty 判断是否重绘） */
  private startRenderLoop(): void {
    const loop = () => {
      if (this.destroyed) return
      this.renderRaf = requestAnimationFrame(loop)
      this.canvas.draw()
    }
    this.renderRaf = requestAnimationFrame(loop)
  }

  /** 覆写画布绘制：DOM 控件定位 + 组件隐藏输入端口 */
  private patchCanvas(): void {
    const proto = LGraphCanvas.prototype
    // 每帧绘制前重置「控件层级计数器」：drawNodeWidgets 补丁按节点绘制顺序给 DOM 控件定 z-index，
    // 让 DOM 层内部的堆叠永远和画布绘制顺序一致（节点被 bringToFront 拖到最前 → 它的控件也压在最上）。
    // 不做这层同步的话，DOM 顺序永远停在控件首次挂载（≈节点创建）顺序 —— 拖动节点会被
    // 别的节点的控件盖住（DOM 层整体在画布之上，画布内的 bringToFront 管不到它）。
    const origDraw = proto.draw as unknown as (...args: unknown[]) => unknown
    proto.draw = function (this: LGraphCanvas & { __wZ?: number; __dragCover?: HTMLElement }, ...args: unknown[]) {
      this.__wZ = 0
      // 没在拖节点就藏起遮罩（拖节点时由 drawNodeWidgets 在对应节点上重新定位并显示）
      const dragSrc = (this as unknown as { node_dragged?: LGraphNode | null }).node_dragged ?? null
      const cover = this.__dragCover
      if (cover && !dragSrc) cover.style.display = 'none'
      return origDraw.apply(this, args)
    } as unknown as typeof proto.draw

    // 折叠节点：litegraph 的 drawNode 在 collapsed 时只画标题条，然后 **直接 return**，
    // 根本不会走到 drawNodeWidgets → DOM 控件层永远拿不到 "隐藏" 指令，会浮在折叠后的节点外面。
    // 所以在这里兜一层：每帧按 collapsed 状态切换 DOM 显示（展开时由 drawNodeWidgets 重新定位）。
    const origDrawNode = proto.drawNode
    proto.drawNode = function (this: LGraphCanvas, node: LGraphNode, ctx: CanvasRenderingContext2D) {
      const collapsed = !!node.flags?.collapsed
      for (const w of node.widgets || []) {
        const el = w.element
        if (el) el.style.display = collapsed ? 'none' : ''
      }
      return origDrawNode.call(this, node, ctx)
    }

    const orig = proto.drawNodeWidgets
    proto.drawNodeWidgets = function (
      this: LGraphCanvas & { __domLayer?: HTMLElement; __wZ?: number },
      node: LGraphNode,
      posY: number,
      ctx: CanvasRenderingContext2D,
      active: object
    ) {
      // 「组件即端口」：有组件的输入不占端口行，但组件必须排在**所有端口行带**之下（ComfyUI 1.x 同款）。
      // 端口行带 = max(最后一个纯输入端口的行下标 + 1, 输出行数) —— 输入和输出共用同一条垂直栅格
      // （输出行 j 的点位就是本地 y = (j+0.7)*slotH）。之前只算纯输入、漏了输出行，
      // 导致输出名/端口点和第一行组件挤在同一行，只能靠右侧让出一整条「输出列」避让 → 右缘歪一边。
      const slotH = LiteGraph.NODE_SLOT_HEIGHT || 24
      let lastInRow = -1
      ;(node.inputs || []).forEach((s, i) => {
        if (!(s as unknown as { widget?: unknown }).widget) lastInRow = i
      })
      const rows = Math.max(lastInRow + 1, (node.outputs || []).length)
      ;(node as unknown as { widgets_start_y?: number }).widgets_start_y = Math.max(4, rows * slotH + 4)

      orig.call(this, node, posY, ctx, active)
      const layer = this.__domLayer
      const widgets = node.widgets
      const ds = this.ds
      if (!layer || !widgets || !ds) return
      const scale = ds.scale
      const show = scale > 0.5
      const m = ctx.getTransform()
      const nodeW = node.size[0]
      const nodeH = node.size[1]
      // ComfyUI 1.x：组件左右内缩对称（8px）。右缘 = nodeW-8，恰好与输出端口点的右缘对齐
      // （端口锚点本地 x = nodeW+1-13 = nodeW-12，点半径 4 → 右缘 nodeW-8），不再给输出名单独留列。
      const INSET = 8
      const meta = node as unknown as NodeLayoutMeta
      meta.__minH = 24
      meta.__rows = []
      // 控件 z-index = 本帧绘制顺序（draw 覆写里每帧清零计数器）。
      // 拖拽中的节点被 litegraph bringToFront 画在最后 → 它的控件压住所有其它节点（ComfyUI 同款）。
      // 拖拽节点额外 +100000，确保它的控件稳稳压在遮罩之上（遮罩 z-index=50000，其它节点控件 ≤ ~457）。
      const zOrder = (this.__wZ = (this.__wZ ?? 0) + 1)
      // 正在拖的节点（litegraph 会把它 bringToFront，画在最后所以 zOrder 最大）
      const dragSrc = (this as unknown as { node_dragged?: LGraphNode | null }).node_dragged ?? null
      const isDragSrc = !!dragSrc && dragSrc === node
      for (const w of widgets) {
        const el = w.element
        if (!el) continue
        const y = w.last_y ?? 0
        const opts = (w as unknown as { options?: { flexible?: boolean; minHeight?: number } }).options || {}
        const flexible = !!opts.flexible
        const x = INSET
        const wpx = Math.max(40, nodeW - INSET * 2)
        const minH = opts.minHeight ?? 24
        // 弹性控件（图片/聊天）：高度 = 节点剩余高度，随节点拉伸等比放大
        const flexH = Math.max(minH, nodeH - y - 8)
        const elH = flexible ? flexH : el.offsetHeight
        meta.__minH = Math.max(meta.__minH, y + (flexible ? minH : elH) + 10)

        const slot = node.inputs?.find((s) => (s as unknown as { widget?: unknown }).widget === w)
        // 组件行 ←→ 输入端口：供「隐藏端口」命中、hover 显示、置灰状态使用
        if (slot) {
          const idx = (node.inputs || []).indexOf(slot)
          meta.__rows.push({ widget: w, slot, y, h: elH })
          el.dataset.slot = String(idx)
          el.dataset.nodeId = String(node.id)
          el.dataset.linked = slot.link != null ? '1' : '0'
          el.style.setProperty('--port-color', slotColor(String(slot.type)))
        } else {
          delete el.dataset.slot
          delete el.dataset.nodeId
        }

        if (!show || node.flags?.collapsed) {
          el.style.display = 'none'
          continue
        }
        const sx = m.a * x + m.c * y + m.e
        const sy = m.b * x + m.d * y + m.f
        el.style.display = ''
        el.style.position = 'absolute'
        el.style.left = '0'
        el.style.top = '0'
        el.style.width = `${wpx}px`
        el.style.height = flexible ? `${flexH}px` : ''
        el.style.pointerEvents = 'auto'
        el.style.opacity = ''
        el.style.zIndex = String(zOrder + (isDragSrc ? 100000 : 0))
        el.style.transformOrigin = '0 0'
        el.style.transform = `translate(${sx}px, ${sy}px) scale(${scale})`
        if (el.parentElement !== layer) layer.appendChild(el)
      }
      // ---- 拖拽遮罩：把正在拖的节点底色（画布层）用一块同色 DOM 盖到下面节点的控件之上 ----
      // 覆盖区域 = 节点 body（local 0,0 → nodeW,nodeH；标题栏留在画布上不遮，保留节点辨识度）。
      if (isDragSrc) {
        const cover = (this as unknown as { __dragCover?: HTMLElement }).__dragCover
        if (cover) {
          const cx = m.e
          const cy = m.f
          cover.style.display = ''
          cover.style.transformOrigin = '0 0'
          cover.style.transform = `translate(${cx}px, ${cy}px) scale(${scale})`
          cover.style.width = `${nodeW}px`
          cover.style.height = `${nodeH}px`
          // body 填充色与 drawNodeShape 完全同源：node.bgcolor（颜色预设）|| 主题色 NV.nodeBody
          const bgc = node as unknown as { bgcolor?: string }
          cover.style.background = bgc.bgcolor || NV.nodeBody
        }
      }
      // ---- 组件隐藏输入端口：拖线时在组件左侧浮现，可直接落线 ----
      if (!show) return
      const connecting = this.connecting_node
      if (!connecting) return
      const gm = (this as unknown as { graph_mouse?: [number, number] }).graph_mouse
      const hovered = gm ? this.graph.getNodeOnPos(gm[0], gm[1], this.visible_nodes) : null
      if (hovered !== node) return
      const linkType = (this.connecting_output || this.connecting_input)?.type
      ctx.save()
      for (const row of meta.__rows) {
        if (row.slot.link != null) continue
        if (!typesCompatible(linkType, String(row.slot.type))) continue
        const cy = row.y + Math.min(row.h, 26) / 2
        const r = 4.5
        ctx.beginPath()
        ctx.arc(INSET - 4, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = '#0b0e13'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = slotColor(String(row.slot.type))
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  /**
   * 输出名所需的节点宽度（图坐标），只用于最小宽度约束。
   *
   * litegraph 的几何（**别凭直觉猜，这段是实测出来的**）：
   *   - 输出端口锚点：`getConnectionPos(false, i)` = `pos[0] + size[0] + 1 - NODE_SLOT_HEIGHT/2`
   *     （`offset = NODE_SLOT_HEIGHT * 0.5`），即本地 x = `nodeW - 12`（slotH=26 时）
   *   - 输出名：`textAlign='right'` + `fillText(name, 锚点x - 10)` → **文本右缘 = nodeW - 22**
   *     （不是 nodeW-10！踩过一次：按 -10 算会得出"有 14px 间隔"的假结论，实际只剩 3px）
   *
   * 注意：不能只依赖绘制期缓存 —— `minSizeOf()` 是构造/加载时就要用的，那时还没画过。
   */
  private outNeed(node: LGraphNode): number {
    const outs = node.outputs || []
    if (!outs.length) return 0
    const names = outs.map((o) => String((o as { label?: string }).label ?? o.name ?? ''))
    const key = names.join('|')
    const meta = node as unknown as { __outCol?: { key: string; need: number } }
    if (meta.__outCol && meta.__outCol.key === key) return meta.__outCol.need

    const canvas = this.canvas as unknown as { ctx?: CanvasRenderingContext2D; inner_text_font?: string }
    let tw = 0
    const ctx = canvas?.ctx
    if (ctx) {
      const prevFont = ctx.font
      // 输出名用的就是画布内部的 slot 字体（normal 12.5px Inter/Segoe UI…）
      ctx.font = canvas.inner_text_font || `${LiteGraph.NODE_SUBTEXT_SIZE}px Arial`
      for (const n of names) if (n) tw = Math.max(tw, ctx.measureText(n).width)
      ctx.font = prevFont
    } else {
      // 画布还没建好时按 8.4px/字符（12.5px 全大写均值）估，宁可多留
      for (const n of names) tw = Math.max(tw, n.length * 8.4)
    }
    const slotH = LiteGraph.NODE_SLOT_HEIGHT || 24
    // 10px 视觉间隔 + 1（锚点 +1）+ 半个端口行高（锚点左移量）
    const need = Math.ceil(tw) + 10 + 1 + Math.round(slotH / 2)
    meta.__outCol = { key, need }
    return need
  }

  /** ComfyUI 点阵网格背景（点 + 每 100px 细线，保证一眼能看出画布范围） */
  private setupGrid(): void {
    this.canvas.onDrawBackground = (ctx, visibleArea) => {
      const [x, y, w, h] = visibleArea
      ctx.fillStyle = NV.canvas
      ctx.fillRect(x, y, w, h)

      const step = 20
      const scale = this.canvas.ds?.scale || 1
      // 缩得很小时点太密，只画细线
      if (scale > 0.45) {
        ctx.fillStyle = 'rgba(255,255,255,0.075)'
        const sx = Math.floor(x / step) * step
        const sy = Math.floor(y / step) * step
        const size = scale > 1.2 ? 1.8 : 1.4
        for (let gx = sx; gx < x + w; gx += step) {
          for (let gy = sy; gy < y + h; gy += step) {
            ctx.fillRect(gx, gy, size, size)
          }
        }
      }
      // 100px 大格：细线，帮助判断对齐与距离
      const big = step * 5
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'
      ctx.lineWidth = 1 / scale
      ctx.beginPath()
      for (let gx = Math.floor(x / big) * big; gx < x + w; gx += big) {
        ctx.moveTo(gx, y)
        ctx.lineTo(gx, y + h)
      }
      for (let gy = Math.floor(y / big) * big; gy < y + h; gy += big) {
        ctx.moveTo(x, gy)
        ctx.lineTo(x + w, gy)
      }
      ctx.stroke()
      // litegraph 的 drawGroups 在「背景填充」之前调用，会被上面的底色盖掉，
      // 所以填完底和网格后再补一次（同一帧内两次绘制，前一次被完全覆盖，无副作用）。
      if (((this.graph as unknown as { _groups?: unknown[] })._groups || []).length) {
        this.canvas.drawGroups(this.canvas.canvas, ctx)
      }
    }
    // 缩放手柄：右下角画斜纹角标（命中区在 setupResizeHandle 里放大到 26px）
    this.canvas.onDrawForeground = (ctx) => {
      const ds = this.canvas.ds
      if (!ds || ds.scale < 0.35) return
      for (const node of Object.values(nodesOf(this.graph))) {
        if (node.flags?.collapsed || node.resizable === false) continue
        const hot = this.hoverResizeId === node.id || this.resizeState?.node === node
        const [nx, ny] = node.pos
        const [nw, nh] = node.size
        const s = 13
        ctx.save()
        if (hot) {
          // 悬停：右下角铺一块半透明三角，明确「这里可以拉大」
          ctx.fillStyle = 'rgba(122,176,255,0.28)'
          ctx.beginPath()
          ctx.moveTo(nx + nw - s, ny + nh)
          ctx.lineTo(nx + nw, ny + nh - s)
          ctx.lineTo(nx + nw, ny + nh)
          ctx.closePath()
          ctx.fill()
        }
        ctx.strokeStyle = hot ? '#bcd8ff' : 'rgba(255,255,255,0.34)'
        ctx.lineCap = 'round'
        ctx.lineWidth = hot ? 2.2 : 1.6
        ctx.beginPath()
        for (let i = 0; i < 3; i++) {
          const d = i * 3.6 + 2.4
          ctx.moveTo(nx + nw - d, ny + nh - 1.2)
          ctx.lineTo(nx + nw - 1.2, ny + nh - d)
        }
        ctx.stroke()
        ctx.restore()
      }
    }
    this.canvas.onDrawOverlay = () => { /* 保留给执行高亮 */ }
  }

  // ==================== 缩放手柄（放大命中区） ====================

  /**
   * litegraph 原生的缩放手柄命中区只有 10×10（右下角最后 5px），
   * 实际很难点中。这里在容器层做捕获：距右下角 26px 内即进入缩放，
   * 并自行实现拖拽（带最小尺寸限制、无上限）。
   */
  private setupResizeHandle(): void {
    const host = this.host
    host.addEventListener('pointermove', (e) => {
      const node = this.nodeAtResizeCorner(e)
      const id = node ? node.id : null
      if (id !== this.hoverResizeId) {
        this.hoverResizeId = id
        if (!this.resizeState) this.canvas.canvas.style.cursor = id ? 'nwse-resize' : ''
        this.canvas.setDirty(true, false)
      }
    })
    host.addEventListener('pointerleave', () => {
      if (this.hoverResizeId != null && !this.resizeState) {
        this.hoverResizeId = null
        this.canvas.setDirty(true, false)
      }
    })
    host.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return
        const node = this.nodeAtResizeCorner(e)
        if (!node) return
        e.preventDefault()
        e.stopPropagation()
        const [cx, cy] = this.canvas.convertEventToCanvasOffset(e)
        this.resizeState = { node, startX: cx, startY: cy, startW: node.size[0], startH: node.size[1] }
        this.canvas.canvas.style.cursor = 'nwse-resize'
        window.addEventListener('pointermove', this.onResizeMove)
        window.addEventListener('pointerup', this.onResizeUp, { once: true })
        this.notifyChange()
      },
      true
    )
  }

  private onResizeMove = (e: PointerEvent): void => {
    const st = this.resizeState
    if (!st) return
    const [cx, cy] = this.canvas.convertEventToCanvasOffset(e)
    const min = this.minSizeOf(st.node)
    // 向下/向右无上限；向上/向左有下限（保证标题、端口、组件都放得下）
    const w = Math.max(min[0], st.startW + (cx - st.startX))
    const h = Math.max(min[1], st.startH + (cy - st.startY))
    st.node.setSize([Math.round(w), Math.round(h)])
    this.canvas.setDirty(true, true)
  }

  private onResizeUp = (): void => {
    if (this.resizeState) {
      this.canvas.setDirty(true, true)
      this.notifyChange()
    }
    this.resizeState = null
    this.canvas.canvas.style.cursor = this.hoverResizeId ? 'nwse-resize' : ''
    window.removeEventListener('pointermove', this.onResizeMove)
  }

  /** 点是否落在某个节点右下角的缩放手柄内（命中区 26px，含略微超出节点边界） */
  private nodeAtResizeCorner(e: PointerEvent): LGraphNode | null {
    const [cx, cy] = this.canvas.convertEventToCanvasOffset(e)
    const reach = 26 / (this.canvas.ds?.scale || 1)
    let best: LGraphNode | null = null
    for (const node of Object.values(nodesOf(this.graph))) {
      if (node.flags?.collapsed || node.resizable === false) continue
      const [nx, ny] = node.pos
      const [nw, nh] = node.size
      const dx = cx - (nx + nw)
      const dy = cy - (ny + nh)
      if (dx <= 4 && dy <= 4 && dx >= -reach && dy >= -reach) best = node
    }
    return best
  }

  /** 节点最小尺寸：宽度够放下名称+控件，高度 = 组件排布后的真实内容高度 */
  minSizeOf(node: LGraphNode): [number, number] {
    // 输出名右对齐画在 nodeW-22 处，节点太窄会戳出左边界：
    // 最小宽度要容下最长的输出名（outNeed ≈ 文本宽 + 端口几何），再留 40px 呼吸。
    const outNeed = this.outNeed(node)
    const baseW = node.widgets?.length ? 220 : 120
    const minW = Math.max(baseW, outNeed ? outNeed + 40 : 0)
    const meta = node as unknown as NodeLayoutMeta
    const minH = Math.max(60, meta.__minH || node.computeSize?.()[1] || 100)
    return [minW, Math.round(minH)]
  }

  /** 右键菜单（画布空白 = 搜索框；节点上 = 自定义节点菜单） */
  private setupMenus(): void {
    this.canvas.getCanvasMenuOptions = () => [
      { content: '添加节点', callback: () => this.openSearchAt(this.lastMouseEvent) },
      { content: '粘贴', callback: () => { void this.pasteFromClipboard() } },
      null,
      { content: '全选', callback: () => this.selectAll() },
      {
        content: `从选中节点创建组${this.selectedNodes().length ? `（${this.selectedNodes().length} 个）` : ''}`,
        callback: () => this.createGroupFromSelection()
      },
      null,
      {
        content: '整理视图',
        callback: () => this.canvas.ds?.reset?.()
      }
    ]
    // 记录最后一次鼠标位置（菜单/搜索框定位用）
    this.host.addEventListener('pointermove', (e) => { this.lastMouseEvent = e })
    // 右键：节点上 → 自定义节点菜单（删除/重命名/颜色/忽略…）；
    // 组标题条上 → 组菜单；画布空白 → 搜索框（ComfyUI 同款）。
    this.host.addEventListener('contextmenu', (e) => {
      const [cx, cy] = this.canvas.convertEventToCanvasOffset(e)
      const hitNode = this.graph.getNodeOnPos(cx, cy, this.canvas.visible_nodes)
      e.preventDefault()
      e.stopPropagation()
      if (hitNode) {
        // 多选时右键其中一个：保持整组选中，菜单对全部生效
        if (!hitNode.is_selected) this.canvas.selectNodes([hitNode])
        const sel = this.selectedNodes()
        const targets = sel.length ? sel.map((n) => n.id) : [hitNode.id]
        this.onNodeContextMenu?.({
          kind: 'node',
          clientX: e.clientX,
          clientY: e.clientY,
          nodeId: hitNode.id,
          title: String(hitNode.title ?? hitNode.type ?? '节点'),
          bypassed: Number(hitNode.mode ?? 0) === 4,
          collapsed: !!hitNode.flags?.collapsed,
          color: (hitNode as unknown as { __customColor?: string }).__customColor ?? null,
          targets
        })
        return
      }
      // 组标题条 → 组菜单（组内部空白仍然弹搜索框，避免把画布右键吞掉）
      const group = this.groupAt(cx, cy, true)
      if (group) {
        const nodes = this.groupNodes(group.__gid)
        const allBypassed = nodes.length > 0 && nodes.every((n) => Number(n.mode ?? 0) === 4)
        this.onNodeContextMenu?.({
          kind: 'group',
          clientX: e.clientX,
          clientY: e.clientY,
          nodeId: -1,
          title: String(group.title || '组'),
          bypassed: allBypassed,
          collapsed: false,
          color: null,
          targets: nodes.map((n) => n.id),
          groupId: group.__gid,
          groupTitle: String(group.title || '组'),
          groupNodes: nodes.length,
          groupBypassed: allBypassed
        })
        return
      }
      this.openSearchAt(e)
    }, true)
  }

  private lastMouseEvent: MouseEvent | null = null

  /** 判断事件是否落在某个节点的端口上（右键端口要放行给 litegraph 拖线） */
  private isOverPort(node: LGraphNode, e: MouseEvent): { input: boolean; slot: number } | null {
    const pos = this.canvas.convertEventToCanvasOffset(e)
    const inSlot = this.canvas.isOverNodeInput(node, pos[0], pos[1])
    if (inSlot !== -1) return { input: true, slot: inSlot }
    const outSlot = this.canvas.isOverNodeOutput(node, pos[0], pos[1])
    if (outSlot !== -1) return { input: false, slot: outSlot }
    return null
  }

  /** 在鼠标处打开搜索浮层 */
  openSearchAt(e: MouseEvent | null): void {
    const [cx, cy] = e
      ? this.canvas.convertEventToCanvasOffset(e)
      : this.canvas.convertOffsetToCanvas?.(this.canvas.ds?.offset || [0, 0]) || [0, 0]
    this.onOpenSearchBox?.({
      clientX: e?.clientX ?? window.innerWidth / 2,
      clientY: e?.clientY ?? window.innerHeight / 2,
      canvasX: cx,
      canvasY: cy
    })
  }

  /**
   * 覆写 processMouseUp：拖线到画布空白处松手时，不直接取消，
   * 而是弹出搜索浮层（带端口类型过滤），选中节点后自动连线。
   * （复刻 ComfyUI fork 的 shift+松手 / 拖线释放行为）
   */
  private patchProcessMouseUp(): void {
    if ((LGraphCanvas.prototype as unknown as { __comfyPatched?: boolean }).__comfyPatched) return
    // litegraph 内部给鼠标事件扩展了画布坐标字段
    type CanvasMouseEvent = MouseEvent & { canvasX: number; canvasY: number }
    type PatchedCanvas = Omit<LGraphCanvas, 'processMouseUp'> & {
      __comfyPatched?: boolean
      __origProcessMouseUp?: (e: CanvasMouseEvent) => void
      __onSearchBoxFromLink?: (f: SearchBoxFilter) => void
      /** 覆写后放宽返回值（litegraph 内部不消费返回值） */
      processMouseUp: (e: CanvasMouseEvent) => void
    }
    const proto = LGraphCanvas.prototype as unknown as PatchedCanvas
    proto.__comfyPatched = true
    const orig = proto.processMouseUp as unknown as (e: CanvasMouseEvent) => void
    proto.__origProcessMouseUp = orig
    proto.processMouseUp = function (this: PatchedCanvas, e: CanvasMouseEvent): void {
      // 原版在函数开头才 adjustMouseEvent；本覆写先于原版执行，需自行换算画布坐标
      this.adjustMouseEvent(e)
      const connecting = this.connecting_node
      const outSlot = this.connecting_output
      const inSlot = this.connecting_input
      const slot = this.connecting_slot
      const onNode = this.graph.getNodeOnPos(e.canvasX, e.canvasY, this.visible_nodes)
      // 多选：按在已选节点上拖动 = 整组拖动；没拖动（单击）才收敛为单选
      const keep = (this as unknown as { __keepSel?: { node: LGraphNode; x: number; y: number } }).__keepSel
      if (keep) {
        ;(this as unknown as { __keepSel?: unknown }).__keepSel = null
        const moved = Math.abs(e.clientX - keep.x) + Math.abs(e.clientY - keep.y)
        if (moved < 4 && keep.node.is_selected) {
          this.deselectAllNodes()
          keep.node.is_selected = true
          ;(this.selected_nodes as Record<number, LGraphNode>)[keep.node.id] = keep.node
          this.setDirty(true, false)
        }
      }
      // 拖线中 + 落点空白 → 取消本次拖线，改弹搜索框
      if (connecting && !onNode && this.__onSearchBoxFromLink) {
        // 必须清 connecting_pos：drawFrontCanvas 以它非空为拖线渲染条件，
        // 仅清 output/input 会导致 connInOrOut 为 null 读取 .type 崩溃。
        this.connecting_node = null
        this.connecting_output = null
        this.connecting_input = null
        this.connecting_slot = null
        this.connecting_pos = null
        this._highlight_input = null
        this.dirty_canvas = true
        this.dirty_bgcanvas = true
        this.__onSearchBoxFromLink({
          clientX: e.clientX,
          clientY: e.clientY,
          canvasX: e.canvasX,
          canvasY: e.canvasY,
          fromNodeId: connecting.id,
          fromSlot: slot ?? undefined,
          fromType: (outSlot || inSlot)?.type,
          fromOutput: !!outSlot
        })
        return
      }
      // 从「组件隐藏端口」起手的连线是 input-origin：litegraph 这条分支没有设置
      // connecting_slot（只有 output-origin 才设），于是松开时执行的是
      // `node.connect(outputSlot, connecting_node, undefined)` —— 目标输入下标为 undefined，
      // 连接被静默丢弃。这里按「目标节点上的输入下标」补上，输入端拖线才能真的连上。
      if (connecting && inSlot && slot == null) {
        const idx = (connecting.inputs || []).indexOf(inSlot as never)
        if (idx >= 0) (this as unknown as { connecting_slot: number }).connecting_slot = idx
      }
      orig.call(this, e)
    }
  }

  /**
   * 组件隐藏输入端口（ComfyUI 同款）：
   * 拖线经过节点时，每个「还没连线」的组件左侧会浮现一个小圆点，
   * 圆点落在组件行上，命中判定返回该组件对应的输入端口下标。
   * litegraph 原生只认端口列的圆点，这里补上组件行的命中区。
   */
  private patchIsOverNodeInput(): void {
    type Patched = typeof LGraphCanvas.prototype & { __comfyInputPatched?: boolean }
    const proto = LGraphCanvas.prototype as unknown as Patched
    if (proto.__comfyInputPatched) return
    proto.__comfyInputPatched = true
    const orig = LGraphCanvas.prototype.isOverNodeInput
    LGraphCanvas.prototype.isOverNodeInput = function (
      this: LGraphCanvas,
      node: LGraphNode,
      canvasx: number,
      canvasy: number,
      slot_pos?: [number, number]
    ): number {
      const hit = orig.call(this, node, canvasx, canvasy, slot_pos)
      if (hit !== -1) return hit
      if (!this.connecting_node || this.connecting_node === node) return -1
      const meta = node as unknown as NodeLayoutMeta
      if (!meta.__rows?.length) return -1
      if (node.flags?.collapsed) return -1
      const [nx, ny] = node.pos
      if (canvasx < nx - 6 || canvasx > nx + 20) return -1
      for (const row of meta.__rows) {
        if (row.slot.link != null) continue
        const cy = ny + row.y + Math.min(row.h, 26) / 2
        if (Math.abs(canvasy - cy) > 12) continue
        const idx = (node.inputs || []).findIndex((s) => s === (row.slot as unknown))
        if (idx >= 0) return idx
      }
      return -1
    } as typeof LGraphCanvas.prototype.isOverNodeInput
  }

  /**
   * 多选整组拖动（ComfyUI / 资源管理器一致的行为）：
   *  - 鼠标按在「已选中的节点」上且当前是多选 → **不清空选择**，直接整组拖动；
   *  - 若是单纯点一下（没位移），松手时才把选择收敛成这一个节点。
   * litegraph 原生在 mousedown 就 selectNode(单节点) → 多选立刻消失，所以必须覆写。
   */
  private patchSelection(): void {
    type Patched = typeof LGraphCanvas.prototype & {
      __comfySelPatched?: boolean
      __keepSel?: { node: LGraphNode; x: number; y: number } | null
    }
    const proto = LGraphCanvas.prototype as unknown as Patched
    if (proto.__comfySelPatched) return
    proto.__comfySelPatched = true
    const orig = LGraphCanvas.prototype.processNodeSelected
    LGraphCanvas.prototype.processNodeSelected = function (
      this: LGraphCanvas & { __keepSel?: { node: LGraphNode; x: number; y: number } | null },
      node: LGraphNode,
      e?: MouseEvent
    ): void {
      const additive = !!(e && (e.shiftKey || e.ctrlKey || this.multi_select))
      const count = Object.keys(this.selected_nodes || {}).length
      if (!additive && node.is_selected && count > 1) {
        this.__keepSel = { node, x: e?.clientX ?? 0, y: e?.clientY ?? 0 }
        return
      }
      this.__keepSel = null
      orig.call(this, node, e as never)
    } as typeof LGraphCanvas.prototype.processNodeSelected
  }

  /** 只选中一个节点（不走 selectNodes 的「已选中就取消」开关语义） */
  private selectOnly(node: LGraphNode): void {
    this.canvas.deselectAllNodes()
    node.is_selected = true
    ;(this.canvas.selected_nodes as Record<number, LGraphNode>)[node.id] = node
    this.canvas.setDirty(true, false)
  }

  /** 当前选中的节点（按选中顺序） */
  selectedNodes(): LGraphNode[] {
    return Object.values(this.canvas.selected_nodes || {}) as LGraphNode[]
  }

  /**
   * 组件隐藏端口的「悬停显示 + 按住拖出连线」。
   * 端口本身是 DOM 里的一个小圆点（跟随组件行），按住时把一次 pointerdown
   * 合成派发到画布上同一个坐标，剩下的拖线全交给 litegraph 原生流程。
   */
  private setupPortDrag(): void {
    // 用 mousedown（而不是 pointerdown）：本版 litegraph 的 pointerevents_method 是 "mouse"，
    // 拖线延续依赖 document 的 mousemove/mouseup；若在 pointerdown 里 preventDefault，
    // 浏览器会把后续的兼容鼠标事件流掐掉，导致拖到一半"冻住"（graph_mouse 不再更新）。
    this.domLayer.addEventListener(
      'mousedown',
      (e) => {
        const target = e.target as HTMLElement
        if (!target?.classList?.contains('lg-port')) return
        const row = target.closest('[data-slot]') as HTMLElement | null
        const nodeId = Number(row?.dataset.nodeId)
        const slotIdx = Number(row?.dataset.slot)
        if (!row || !Number.isFinite(nodeId) || !Number.isFinite(slotIdx)) return
        e.stopPropagation()
        const rect = target.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        // 注意：这版 litegraph 的 pointerevents_method 是 "mouse"，
        // 监听的是 mousedown/move/up（不是 pointerdown）。这里必须合成 mousedown，
        // 且合成事件的 which 恒为 0、而 processMouseDown 用 `e.which == 1` 判左键，需手动补。
        const ev = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          button: 0,
          buttons: 1
        })
        Object.defineProperty(ev, 'which', { value: 1 })
        // litegraph 在 pointerdown 里铺开 document 级 move/up 监听 → 之后的真实拖动全部接管
        this.canvas.canvas.dispatchEvent(ev)
      },
      true
    )
  }

  // ==================== 组（Group） ====================

  private groupSeq = 0

  /** 全部组（补一个稳定的运行时 id，菜单/接口都用它定位） */
  groups(): GroupHandle[] {
    const list = ((this.graph as unknown as { _groups?: GroupHandle[] })._groups || []) as GroupHandle[]
    for (const g of list) {
      if (!g.__gid) g.__gid = ++this.groupSeq
      else this.groupSeq = Math.max(this.groupSeq, g.__gid)
    }
    return list
  }

  groupById(gid: number): GroupHandle | null {
    return this.groups().find((g) => g.__gid === gid) || null
  }

  /** 图坐标处的组（headerOnly 时只认标题条那一条，避免吞掉画布右键） */
  private groupAt(x: number, y: number, headerOnly = false): GroupHandle | null {
    const list = this.groups()
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i]
      const [gx, gy] = g._pos
      const [gw, gh] = g._size
      if (x < gx || x > gx + gw || y < gy || y > gy + gh) continue
      if (headerOnly && y > gy + GROUP_HEADER_H) continue
      return g
    }
    return null
  }

  /** 从选中节点创建组（ComfyUI 的 Ctrl+G）；没有选中就返回 false */
  createGroupFromSelection(title?: string): number | null {
    const nodes = this.selectedNodes()
    if (!nodes.length) return null
    const gid = this.createGroup(nodes, title)
    return gid
  }

  /** 用一组节点算出包围盒并建组 */
  createGroup(nodes: LGraphNode[], title?: string): number | null {
    if (!nodes.length) return null
    // 组的顶端要给「标题条 + 节点 id 角标 + 组头」留足空间，
    // 否则节点角标会压到组标题条上（视觉上像错位）。
    const titleH = LiteGraph.NODE_TITLE_HEIGHT || 26
    const topPad = titleH + 24 + GROUP_HEADER_H + 8
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.pos[0])
      minY = Math.min(minY, n.pos[1])
      maxX = Math.max(maxX, n.pos[0] + n.size[0])
      maxY = Math.max(maxY, n.pos[1] + n.size[1])
    }
    const pad = 16
    const top = Math.round(minY - topPad)
    const bounds: [number, number, number, number] = [
      Math.round(minX - pad),
      top,
      Math.round(maxX - minX + pad * 2),
      Math.round(maxY + pad - top)
    ]
    const group = new (LiteGraph as unknown as { LGraphGroup: new (t: string) => GroupHandle }).LGraphGroup(
      title || `组 ${this.groups().length + 1}`
    )
    group._bounding.set(bounds)
    group.__gid = ++this.groupSeq
    ;(this.graph as unknown as { _groups: GroupHandle[] })._groups.push(group)
    ;(group as unknown as { graph?: unknown }).graph = this.graph
    group.recomputeInsideNodes()
    // 组铺在最底层，但 nodes 的绘制顺序不受影响
    this.canvas.setDirty(true, true)
    this.notifyChange()
    return group.__gid
  }

  renameGroup(gid: number, title: string): void {
    const g = this.groupById(gid)
    const t = title.trim()
    if (!g || !t) return
    g.title = t
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  deleteGroup(gid: number, keepNodes = true): void {
    const g = this.groupById(gid)
    if (!g) return
    const raw = this.graph as unknown as { _groups: GroupHandle[] }
    raw._groups = raw._groups.filter((x) => x !== g)
    if (!keepNodes) for (const n of g._nodes || []) this.graph.remove(n)
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 组内节点（实时重算，避免拖进/拖出后不同步） */
  groupNodes(gid: number): LGraphNode[] {
    const g = this.groupById(gid)
    if (!g) return []
    g.recomputeInsideNodes()
    return [...(g._nodes || [])]
  }

  /** 组操作：忽略 / 取消忽略 / 统一颜色 / 选中组内节点 / 适应内容 / 解散 */
  applyGroupAction(gid: number, action: 'bypass' | 'unbypass' | 'color' | 'select' | 'fit' | 'ungroup', color?: string | null): void {
    const g = this.groupById(gid)
    if (!g) return
    const nodes = this.groupNodes(gid)
    switch (action) {
      case 'bypass':
        for (const n of nodes) this.setNodeBypassed(n.id, true)
        break
      case 'unbypass':
        for (const n of nodes) this.setNodeBypassed(n.id, false)
        break
      case 'color':
        for (const n of nodes) this.setNodeColor(n.id, color ?? null)
        break
      case 'select':
        this.canvas.selectNodes(nodes)
        break
      case 'fit': {
        // 把组框贴合内容（顶部要留出标题条 + 角标 + 组头）
        if (!nodes.length) return
        const titleH = LiteGraph.NODE_TITLE_HEIGHT || 26
        const topPad = titleH + 24 + GROUP_HEADER_H + 8
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of nodes) {
          minX = Math.min(minX, n.pos[0])
          minY = Math.min(minY, n.pos[1])
          maxX = Math.max(maxX, n.pos[0] + n.size[0])
          maxY = Math.max(maxY, n.pos[1] + n.size[1])
        }
        const top = Math.round(minY - topPad)
        g._pos[0] = Math.round(minX - 16)
        g._pos[1] = top
        g._size[0] = Math.round(maxX - minX + 32)
        g._size[1] = Math.round(maxY + 16 - top)
        this.canvas.setDirty(true, true)
        this.notifyChange()
        break
      }
      case 'ungroup':
        this.deleteGroup(gid, true)
        break
    }
    this.canvas.setDirty(true, true)
  }

  /** 每次节点移动后重算组内成员（拖进/拖出组） */
  private refreshGroups(): void {
    for (const g of this.groups()) g.recomputeInsideNodes()
    this.canvas.setDirty(true, false)
  }


  /** 双击：画布空白 → 搜索；节点标题栏 → 重命名；组标题条 → 改组名 */
  private setupDblClick(): void {
    this.host.addEventListener('dblclick', (e) => {
      const [cx, cy] = this.canvas.convertEventToCanvasOffset(e)
      const hit = this.graph.getNodeOnPos(cx, cy, this.canvas.visible_nodes)
      if (hit) {
        const titleBottom = hit.pos[1]
        const titleTop = titleBottom - (LiteGraph.NODE_TITLE_HEIGHT || 30)
        if (cy >= titleTop && cy <= titleBottom) {
          e.preventDefault()
          e.stopPropagation()
          this.onNodeContextMenu?.({
            kind: 'node',
            clientX: e.clientX,
            clientY: e.clientY,
            nodeId: hit.id,
            title: String(hit.title ?? hit.type ?? '节点'),
            bypassed: Number(hit.mode ?? 0) === 4,
            collapsed: !!hit.flags?.collapsed,
            color: (hit as unknown as { __customColor?: string }).__customColor ?? null,
            intent: 'rename',
            targets: [hit.id]
          })
        }
        return
      }
      const group = this.groupAt(cx, cy, true)
      if (group) {
        e.preventDefault()
        e.stopPropagation()
        const nodes = this.groupNodes(group.__gid)
        this.onNodeContextMenu?.({
          kind: 'group',
          clientX: e.clientX,
          clientY: e.clientY,
          nodeId: -1,
          title: String(group.title || '组'),
          bypassed: false,
          collapsed: false,
          color: null,
          intent: 'rename',
          targets: nodes.map((n) => n.id),
          groupId: group.__gid,
          groupTitle: String(group.title || '组'),
          groupNodes: nodes.length
        })
        return
      }
      this.openSearchAt(e)
    }, true)
  }

  /** 图内容变化追踪：节点增删/连线/拖动/控件改值 → 通知标签页标脏 */
  private setupChangeTracking(): void {
    const notify = () => this.notifyChange()
    const g = this.graph as unknown as {
      onNodeAdded: (n: unknown) => void
      onNodeRemoved: (n: unknown) => void
      onConnectionChange: (n: unknown) => void
    }
    g.onNodeAdded = notify
    g.onNodeRemoved = notify
    g.onConnectionChange = notify
    ;(this.canvas as unknown as { onNodeMoved: (n: unknown) => void }).onNodeMoved = notify
    // DOM 控件（输入框/下拉/滑块）改动通过事件冒泡捕获
    this.host.addEventListener('input', notify)
    this.host.addEventListener('change', notify)
    // 图片控件加载完成 → 真实高度变了，重新撑开所有节点
    this.host.addEventListener('lg-resize', () => {
      for (const n of Object.values(nodesOf(this.graph))) this.refitNodeHeight(n)
    })
  }

  /** 防抖后的变更通知 */
  private notifyChange(): void {
    if (this.suppressChange) return
    this.refreshGroups()
    window.clearTimeout(this.changeTimer)
    this.changeTimer = window.setTimeout(() => this.onChange?.(), 200)
  }

  /**
   * 文件拖放（复刻 ComfyUI 画布行为）：
   *  - .json                     → 打开为工作流
   *  - 图片(png/jpg/webp/gif/bmp) → 命中图片输入节点则回填，否则新建 LoadImage
   *  - text/comfy-node-type      → 左侧节点库拖入，在落点创建节点
   */
  private setupFileDrop(): void {
    const host = this.host
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    // 只有拖「文件」才给高亮反馈；从左侧节点库拖节点进来画布保持完全静默
    // （之前 glows + centerOnNode 会让画布整体亮起、松手后猛地位移，非常影响操作）。
    let depth = 0
    host.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      host.classList.add('drop-active')
    })
    host.addEventListener('dragover', (e) => {
      if (!hasFiles(e) && !e.dataTransfer?.types.includes('text/comfy-node-type')) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })
    host.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) host.classList.remove('drop-active')
    })
    host.addEventListener('drop', (e) => {
      depth = 0
      host.classList.remove('drop-active')
      const dt = e.dataTransfer
      if (!dt) return
      e.preventDefault()
      const pos = this.canvas.convertEventToCanvasOffset(e)

      // 1) 左侧节点库拖入：落点即位置（不移动视图）
      const nodeType = dt.getData('text/comfy-node-type')
      if (nodeType) {
        const node = this.addNode(nodeType, pos)
        if (node) {
          this.canvas.selectNodes([node])
          this.canvas.setDirty(true, true)
          this.notifyChange()
        }
        return
      }

      // 2) 文件
      const files = [...(dt.files || [])]
      for (const file of files) {
        const lower = file.name.toLowerCase()
        if (lower.endsWith('.json')) {
          this.onDropWorkflowFile?.(file)
          continue
        }
        if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) {
          const hit = this.getNodeAt(pos)
          this.onDropImageFile?.(file, pos, hit ? hit.id : null)
        }
      }
    })
  }

  /** 图坐标处命中的节点（拖放图片回填用） */
  getNodeAt(pos: [number, number]): LGraphNode | null {
    for (const n of Object.values(nodesOf(this.graph))) {
      const [x, y] = n.pos
      const [w, h] = n.size
      if (pos[0] >= x && pos[0] <= x + w && pos[1] >= y && pos[1] <= y + h) return n
    }
    return null
  }

  /**
   * 外部设置节点控件值（拖放图片回填 / 工作流还原）
   * 走控件的 setValue（若注册过）→ 同步 DOM → 标脏重绘
   */
  setWidgetValue(nodeId: number, name: string, value: unknown): boolean {
    const node = this.graph.getNodeById(nodeId)
    if (!node) return false
    const w = (node.widgets || []).find((x) => x.name === name) as
      | (DOMWidget & { setValue?: (v: unknown) => void })
      | undefined
    if (!w) return false
    w.value = value
    if (typeof w.setValue === 'function') w.setValue(value)
    w.syncDom?.()
    this.canvas.setDirty(true, true)
    return true
  }

  // ==================== 注册表 ====================

  registerDefs(defs: FrontNodeDef[]): void {
    for (const def of defs) registerNodeType(def, this.cb)
    this.setupGrid()
  }

  // ==================== 节点操作 ====================

  addNode(type: string, pos: [number, number]): LGraphNode | null {
    const node = createNodeOfType(type)
    if (!node) return null
    node.pos = pos
    // 新拖入节点默认 2:3 宽高比，refitNodeHeight 会保留该下限并在首次 refit 后清除标记
    ;(node as unknown as { __freshDrop?: boolean }).__freshDrop = true
    const minH = Math.round(node.size[0] * 1.5)
    if (node.size[1] < minH) node.size[1] = minH
    this.graph.add(node)
    this.refitNodeHeight(node)
    return node
  }

  /**
   * 搜索浮层选中后：创建节点，并按 ComfyUI 规则自动连线
   *  - 从输出端口拖出（fromOutput=true）→ fromNode.connectByType(slot, 新节点, type)
   *  - 从输入端口拖出（fromOutput=false）→ 新节点.connectByTypeOutput(slot, fromNode, type)
   * connectByType 内置「按类型找第一个兼容且空闲的端口」，与 ComfyUI 行为一致。
   */
  addNodeFromSearch(type: string, filter: SearchBoxFilter): LGraphNode | null {
    const node = this.addNode(type, [filter.canvasX, filter.canvasY])
    if (!node || filter.fromNodeId == null || filter.fromSlot == null || !filter.fromType) return node
    const fromNode = this.graph.getNodeById(filter.fromNodeId)
    if (!fromNode) return node
    try {
      if (filter.fromOutput) {
        fromNode.connectByType(filter.fromSlot, node, filter.fromType)
      } else {
        node.connectByTypeOutput(filter.fromSlot, fromNode, filter.fromType)
      }
    } catch (err) {
      console.warn('[ComfyGraph] 自动连线失败（类型不兼容或无空闲端口）:', err)
    }
    this.canvas.setDirty(true, true)
    return node
  }

  private cloneNode(node: LGraphNode): void {
    const json = node.serialize(true) as unknown as WorkflowNodeJSON
    const clone = createNodeOfType(node.type!)
    if (!clone) return
    clone.configure({ ...json, id: undefined } as never)
    clone.pos = [node.pos[0] + 30, node.pos[1] + 30]
    this.graph.add(clone)
  }

  /**
   * AI / 自动化用：把 A 的某个输出连到 B 的某个输入。
   * 目标输入已被占用时先断开旧线（一个输入只接一条，和 ComfyUI 一致）。
   */
  connectNodes(fromId: number, fromSlot: number, toId: number, toSlot: number): { ok: boolean; error?: string } {
    const a = this.graph.getNodeById(fromId)
    const b = this.graph.getNodeById(toId)
    if (!a) return { ok: false, error: `找不到源节点 ${fromId}` }
    if (!b) return { ok: false, error: `找不到目标节点 ${toId}` }
    const out = (a.outputs || [])[fromSlot]
    const inp = (b.inputs || [])[toSlot]
    if (!out) return { ok: false, error: `源节点 ${fromId} 没有第 ${fromSlot} 个输出` }
    if (!inp) return { ok: false, error: `目标节点 ${toId} 没有第 ${toSlot} 个输入` }
    const outType = (out as { type?: string }).type
    const inType = (inp as { type?: string }).type
    if (outType && inType && !typesCompatible(outType, inType)) {
      return { ok: false, error: `端口类型不匹配：${outType} → ${inType}` }
    }
    if ((inp as { link?: number | null }).link != null) {
      try {
        this.graph.removeLink((inp as { link: number }).link)
      } catch {
        /* 旧线已失效，忽略 */
      }
    }
    const ok = a.connect(fromSlot, b, toSlot)
    this.canvas.setDirty(true, true)
    this.notifyChange()
    return ok ? { ok: true } : { ok: false, error: '连线失败（类型不兼容或端口已占满）' }
  }

  /** 清空画布 */
  clear(): void {
    this.graph.clear()
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 画布摘要（AI 读画布 / 前端展示用） */
  summary(): {
    nodes: Array<{
      id: number
      type: string
      title: string
      pos: [number, number]
      inputs: Array<{ name: string; type: string; linked: boolean }>
      outputs: Array<{ name: string; type: string }>
      widgets: Array<{ name: string; value: unknown }>
    }>
    links: Array<[number, number, number, number, number, string]>
  } {
    const nodes = Object.values(nodesOf(this.graph)).map((n) => ({
      id: n.id,
      type: String(n.type || ''),
      title: String(n.title || n.type || ''),
      pos: [Math.round(n.pos[0]), Math.round(n.pos[1])] as [number, number],
      inputs: (n.inputs || []).map((s) => ({
        name: String(s.name || ''),
        type: String((s as { type?: string }).type || ''),
        linked: (s as { link?: number | null }).link != null
      })),
      outputs: (n.outputs || []).map((s) => ({
        name: String(s.name || ''),
        type: String((s as { type?: string }).type || '')
      })),
      widgets: (n.widgets || [])
        .filter((w) => w.name !== '__thumb__')
        .map((w) => ({ name: String(w.name || ''), value: w.value }))
    }))
    const links: Array<[number, number, number, number, number, string]> = []
    const rawLinks = (this.graph as unknown as { links: Record<string, { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number; type?: string }> }).links || {}
    for (const l of Object.values(rawLinks)) {
      if (!l) continue
      links.push([l.id, l.origin_id, l.origin_slot, l.target_id, l.target_slot, String(l.type || '')])
    }
    return { nodes, links }
  }

  /** 自动排布一个位置（AI 连续加节点时用，避免全叠在一起） */
  autoPos(index: number): [number, number] {
    const col = index % 4
    const row = Math.floor(index / 4)
    return [120 + col * 300, 120 + row * 220]
  }

  /** 节点颜色预设（ComfyUI 同款色板：只换标题栏 + 同色系更深的主体） */
  static readonly NODE_COLORS: Array<{ name: string; color: string; bg: string }> = [
    { name: '灰', color: '#353535', bg: '#2b2b2b' },
    { name: '红', color: '#8b2f2f', bg: '#3a2020' },
    { name: '橙', color: '#8a5a1e', bg: '#3a2a17' },
    { name: '黄', color: '#8a7a1e', bg: '#3a3520' },
    { name: '绿', color: '#2f6b3a', bg: '#1e3225' },
    { name: '青', color: '#1f6b6b', bg: '#173030' },
    { name: '蓝', color: '#265b9e', bg: '#1c2b40' },
    { name: '紫', color: '#5b3a8a', bg: '#2a2140' },
    { name: '粉', color: '#8a3a68', bg: '#3a2130' }
  ]

  /** 删除节点 */
  removeNode(id: number): void {
    const node = this.graph.getNodeById(id)
    if (!node) return
    this.graph.remove(node)
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 重命名节点（保存进 title，工作流 JSON 会带 _meta.title） */
  renameNode(id: number, title: string): boolean {
    const node = this.graph.getNodeById(id)
    if (!node) return false
    const t = title.trim()
    if (!t) return false
    node.title = t
    this.canvas.setDirty(true, true)
    this.notifyChange()
    return true
  }

  /** 设置节点颜色（传 null 恢复默认） */
  setNodeColor(id: number, color: string | null): void {
    const node = this.graph.getNodeById(id)
    if (!node) return
    const preset = ComfyGraph.NODE_COLORS.find((c) => c.color === color)
    const dyn = node as unknown as { __customColor?: string }
    const n = node as unknown as { color?: string; bgcolor?: string; boxcolor?: string }
    if (!preset) {
      delete dyn.__customColor
      delete n.color
      delete n.bgcolor
      delete n.boxcolor
    } else {
      dyn.__customColor = preset.color
      n.color = preset.color
      n.bgcolor = preset.bg
      n.boxcolor = preset.color
    }
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 忽略节点（bypass）：节点不参与执行，上游输出直接透传给下游同类型输入 */
  setNodeBypassed(id: number, bypassed: boolean): void {
    const node = this.graph.getNodeById(id)
    if (!node) return
    ;(node as unknown as { mode: number }).mode = bypassed ? 4 : 0
    const refresh = (node as unknown as { refreshWidgetStates?: () => void }).refreshWidgetStates
    refresh?.call(node)
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 注入已配置的 API 服务商列表（设置变更 / 启动时由 Vue 层调用） */
  setProviders(list: Parameters<typeof setProviderList>[0]): void {
    setProviderList(list)
    for (const node of Object.values(nodesOf(this.graph))) {
      if (node.type !== 'ApiProvider') continue
      for (const w of node.widgets || []) w.syncDom?.()
      this.refitNodeHeight(node)
    }
    this.canvas.setDirty(true, true)
  }

  toggleCollapse(id: number): void {
    const node = this.graph.getNodeById(id)
    if (!node) return
    node.flags = node.flags || {}
    node.flags.collapsed = !node.flags.collapsed
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  cloneById(id: number): void {
    const node = this.graph.getNodeById(id)
    if (node) this.cloneNode(node)
  }

  private selectAll(): void {
    this.canvas.selectNodes(Object.values(nodesOf(this.graph)))
  }

  /** 批量删除 */
  removeNodes(ids: number[]): void {
    for (const id of ids) {
      const node = this.graph.getNodeById(id)
      if (node) this.graph.remove(node)
    }
    this.canvas.setDirty(true, true)
    this.notifyChange()
  }

  /** 批量忽略 / 取消忽略 */
  setNodesBypassed(ids: number[], bypassed: boolean): void {
    for (const id of ids) this.setNodeBypassed(id, bypassed)
  }

  /** 批量设置节点颜色 */
  setNodesColor(ids: number[], color: string | null): void {
    for (const id of ids) this.setNodeColor(id, color)
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText()
      const data = JSON.parse(text)
      if (!data.nodes) return
      this.loadWorkflow(data)
    } catch { /* 忽略 */ }
  }

  copySelection(): void {
    const nodes = Object.values(this.canvas.selected_nodes || {}) as LGraphNode[]
    if (!nodes.length) return
    const json = { nodes: nodes.map((n) => n.serialize(true)) }
    void navigator.clipboard.writeText(JSON.stringify(json))
  }

  // ==================== 序列化 ====================

  /** 直接复用 litegraph 的序列化（输出即 ComfyUI 工作流格式） */
  serialize(): WorkflowJSON {
    return this.graph.serialize() as unknown as WorkflowJSON
  }

  loadWorkflow(json: WorkflowJSON): void {
    this.suppressChange = true
    this.graph.clear()
    // 必须整体传入（含 last_node_id/last_link_id），否则 configure 后 id 计数器归零，
    // 后续 connect 分配的 link id 会与工作流内已有连线 id 冲突、互相覆盖。
    this.graph.configure({ ...json } as never)
    // configure 后同步控件值（litegraph configure 会写 widgets_values → widget.value）
    for (const node of Object.values(nodesOf(this.graph))) {
      for (const w of node.widgets || []) w.syncDom?.()
      this.refitNodeHeight(node)
      // 恢复「自定义颜色」标记（color/bgcolor 会随工作流存下来，但预设标记是运行时字段）
      const c = (node as unknown as { color?: string }).color
      const preset = c ? ComfyGraph.NODE_COLORS.find((x) => x.color === c) : null
      if (preset) (node as unknown as { __customColor?: string }).__customColor = preset.color
      // 忽略(bypass)节点恢复时也要把控件置灰
      const refresh = (node as unknown as { refreshWidgetStates?: () => void }).refreshWidgetStates
      refresh?.call(node)
    }
    // 组的运行时 id + 成员重算（旧工作流的 groups 字段由 configure 还原）
    for (const g of this.groups()) {
      ;(g as unknown as { graph?: unknown }).graph = this.graph
      g.recomputeInsideNodes()
    }
    this.canvas.setDirty(true, true)
    // 打开工作流后自动适配视图，保证所有节点一眼可见（下一帧等布局稳定）
    if ((json.nodes || []).length) {
      requestAnimationFrame(() => { this.fitView(); this.canvas.setDirty(true, true) })
    }
    // 载入本身不算改动
    window.clearTimeout(this.changeTimer)
    this.suppressChange = false
  }

  // ==================== 执行 ====================

  /** 生成 ComfyUI prompt 格式（含「忽略节点」的上游透传） */
  toPrompt(): Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }> {
    const prompt: Record<string, { class_type: string; inputs: Record<string, unknown>; _extra?: Record<string, unknown>; _meta?: { title: string } }> = {}
    const all = Object.values(nodesOf(this.graph))
    /** 旁路(4)：不执行，但上游同类型输出透传给下游；禁用(2)：彻底不执行，下游断开 */
    const isByPassNode = (n: LGraphNode) => Number(n.mode ?? 0) === 4
    const isMuted = (n: LGraphNode) => Number(n.mode ?? 0) === 2

    /**
     * 解析一条连线的真实来源：
     *  - 普通节点 → 返回 [节点id, 输出下标]
     *  - 被忽略的节点 → 顺着它「同类型且已连线」的输入继续往上找（ComfyUI bypass 行为）；
     *    若那个输入没连线但有控件值，则退化成字面量。
     */
    const resolve = (nodeId: number, slot: number, depth = 0): [string, number] | { value: unknown } | null => {
      if (depth > 32) return null
      const src = this.graph.getNodeById(Number(nodeId))
      if (!src) return null
      if (!isByPassNode(src)) return [String(src.id), slot]
      const outType = (src.outputs?.[slot] as { type?: string } | undefined)?.type
      const inputs = src.inputs || []
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i] as unknown as { type: string; link: number | null; widget?: { value?: unknown } }
        if (!typesCompatible(inp.type, outType)) continue
        if (inp.link != null) {
          const l = this.graph.links[inp.link]
          if (l) return resolve(l.origin_id, l.origin_slot, depth + 1)
          continue
        }
        if (inp.widget && inp.widget.value !== undefined) return { value: inp.widget.value }
      }
      return null
    }

    for (const node of all) {
      if (node.type === 'Reroute') continue
      // mode 2 = 禁用(never)，4 = 旁路(bypass)：ComfyUI 里不参与执行
      if (isByPassNode(node) || isMuted(node)) continue
      const inputs: Record<string, unknown> = {}
      const widgets = node.widgets || []
      // 端口名顺序 = 输入顺序
      const slotNames = (node.inputs || []).map((s) => s.name)
      const widgetByName = new Map(widgets.map((w) => [w.name, w]))
      for (const name of slotNames) {
        const slot = node.inputs!.find((s) => s.name === name)!
        if (slot.link != null) {
          const link = this.graph.links[slot.link]
          if (link) {
            const r = resolve(link.origin_id, link.origin_slot)
            if (Array.isArray(r)) inputs[name] = [r[0], r[1]]
            else if (r && typeof r === 'object' && 'value' in r) inputs[name] = r.value
          }
        } else {
          const w = widgetByName.get(name)
          if (w) inputs[name] = w.value
        }
      }
      // 无端口控件（如输出显示控件、聊天历史）不进 inputs，但聊天历史放 properties.extra_inputs
      const extra = (node.properties as { extra_inputs?: Record<string, unknown> } | undefined)?.extra_inputs
      const entry: { class_type: string; inputs: Record<string, unknown>; _extra?: Record<string, unknown>; _meta?: { title: string } } = {
        class_type: node.type!,
        inputs
      }
      if (extra) entry._extra = extra
      if (node.title) entry._meta = { title: node.title }
      prompt[String(node.id)] = entry
    }
    return prompt
  }

  /** 执行前处理 seed 三态（randomize/increment） */
  applySeedModes(): void {
    for (const node of Object.values(nodesOf(this.graph))) {
      const widgets = (node.widgets || []) as unknown as Array<DOMWidget & { seedMode?: string }>
      for (const w of widgets) {
        if (w.type !== 'dom-seed') continue
        if (w.seedMode === 'randomize') {
          w.value = Math.floor(Math.random() * 1e15)
          this.syncWidgetDom(w)
        } else if (w.seedMode === 'increment') {
          w.value = (w.value as number) + 1
          this.syncWidgetDom(w)
        }
      }
    }
  }

  private syncWidgetDom(w: DOMWidget): void {
    const el = w.element
    if (!el) return
    const input = el.querySelector('input[type=number]') as HTMLInputElement | null
    if (input) input.value = String(w.value)
  }

  /** 执行高亮 */
  setNodeExecuting(nodeId: string | null, active: boolean): void {
    const node = this.graph.getNodeById(Number(nodeId))
    if (node) {
      node.boxcolor = active ? '#85b6ff' : '#666'
      this.canvas.setDirty(true, false)
    }
  }

  /** 执行完成后更新输出节点显示 */
  updateNodeOutput(nodeId: string, output: unknown): void {
    const node = this.graph.getNodeById(Number(nodeId))
    if (!node) return
    const dyn = node as unknown as { outputWidget?: { setValue: (v: unknown) => void }; chatWidget?: { setHistory: (m: Array<{ role: string; content: string }>) => void } }
    if (dyn.outputWidget) {
      const o = output as { images?: unknown[]; text?: unknown[]; ui?: { images?: unknown[]; text?: unknown[] } } | null
      const images = o?.images ?? o?.ui?.images
      const text = o?.text ?? o?.ui?.text
      if (images) dyn.outputWidget.setValue(Array.isArray(images) ? images[0] : images)
      else if (text) dyn.outputWidget.setValue(Array.isArray(text) ? text[0] : text)
      else dyn.outputWidget.setValue(o)
    } else if (dyn.chatWidget && output) {
      const o = output as { chat?: Array<{ role: string; content: string }> }
      if (o?.chat) dyn.chatWidget.setHistory(o.chat)
    }
    this.refitNodeHeight(node)
  }

  /**
   * 按控件真实高度撑开节点，避免文本/图片控件溢出节点边框。
   * DOM 控件高度是运行时才知道的，必须在布局完成后（rAF）再量。
   */
  refitNodeHeight(node: LGraphNode): void {
    // 控件 DOM 是首帧绘制时才挂到 domLayer 的，必须等绘制完成后再量高度
    requestAnimationFrame(() => window.setTimeout(() => {
      const ws = node.widgets || []
      // 主体从 y=0 开始（标题条在 -26 处，不占主体高度）
      const slotH = LiteGraph.NODE_SLOT_HEIGHT || 26
      // 端口行带 = max(最后一个纯输入端口的行下标 + 1, 输出行数) —— 输入输出共用同一条垂直栅格，
      // 组件从端口行带下方开始排（与 drawNodeWidgets 补丁里的 widgets_start_y 保持同一算法）。
      let lastInRow = -1
      ;((node.inputs || []) as Array<{ widget?: unknown }>).forEach((s, i) => {
        if (!s.widget) lastInRow = i
      })
      const rows = Math.max(lastInRow + 1, (node.outputs || []).length)
      let total = 4 + rows * slotH + (node.widgets?.length ? 4 : 6)
      // 弹性控件（图片/缩略图）自身高度跟节点走，不能作为收缩依据
      let flex = false
      for (const w of ws) {
        if ((w.options as { flexible?: boolean } | undefined)?.flexible) flex = true
        // 用 computeSize 而不是 offsetHeight：图片类弹性控件的高度是"跟着节点走"的，
        // 用实际高度会自我放大（每次 refit 都把节点撑高一点）。
        const size = w.computeSize ? w.computeSize(node.size[0]) : null
        const h = size ? size[1] : (w as unknown as { element?: HTMLElement }).element?.offsetHeight || 0
        total += (h || 22) + 3
      }
      const fit = total + 6
      // 新拖入节点默认保持 2:3 宽高比（高 = 1.5 × 宽），避免第一次出现时太扁太宽；
      // 后续 refit（用户手动缩放、加载工作流等）不再受此下限约束。
      const isFresh = (node as unknown as { __freshDrop?: boolean }).__freshDrop === true
      const aspectFloor = isFresh ? Math.round(node.size[0] * 1.5) : 0
      // 非弹性节点：高度严格等于内容（会收缩，否则导入的工作流会拖着一大片空白）；
      // 含弹性控件的节点：只增不减，保留用户手动拉出来的高度。
      const next = flex ? Math.max(node.size[1], fit, aspectFloor) : Math.max(56, fit, aspectFloor)
      if (Math.abs(next - node.size[1]) > 1) {
        node.size[1] = next
        this.canvas.setDirty(true, true)
      }
      // 只在第一次 refit 时生效
      if (isFresh) (node as unknown as { __freshDrop?: boolean }).__freshDrop = false
    }, 60))
  }

  // ==================== 小地图 ====================

  attachMinimap(canvas: HTMLCanvasElement): void {
    this.minimap = canvas
    // 硬保险：尺寸/层级写 inline，杜绝被 `.canvas-host canvas` 之类的通用规则拉满整屏
    // （曾因小地图铺满画布 + z-index 高于主画布，导致真实鼠标事件全部被它吞掉）
    canvas.style.width = '200px'
    canvas.style.height = '130px'
    canvas.style.right = '12px'
    canvas.style.bottom = '12px'
    canvas.style.left = 'auto'
    canvas.style.top = 'auto'
    canvas.style.zIndex = '10'
    // 绘图缓冲区（2x，保证清晰）
    canvas.width = 400
    canvas.height = 260
    this.minimapCtx = canvas.getContext('2d')
    const draw = () => {
      if (!this.minimapCtx || !this.minimap) return
      const ctx = this.minimapCtx
      const W = this.minimap.width
      const H = this.minimap.height
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#171718'
      ctx.fillRect(0, 0, W, H)
      const allNodes = Object.values(nodesOf(this.graph))
      if (!allNodes.length) return
      // 计算包围盒
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of allNodes) {
        minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1])
        maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1])
      }
      const va = this.canvas.visible_area
      minX = Math.min(minX, va[0]); minY = Math.min(minY, va[1])
      maxX = Math.max(maxX, va[0] + va[2]); maxY = Math.max(maxY, va[1] + va[3])
      const pad = 40
      minX -= pad; minY -= pad; maxX += pad; maxY += pad
      const sx = W / (maxX - minX)
      const sy = H / (maxY - minY)
      const s = Math.min(sx, sy)
      const ox = (W - (maxX - minX) * s) / 2
      const oy = (H - (maxY - minY) * s) / 2
      const tx = (x: number) => ox + (x - minX) * s
      const ty = (y: number) => oy + (y - minY) * s
      // 节点
      for (const n of allNodes) {
        ctx.fillStyle = n.boxcolor || '#4a4f5a'
        ctx.fillRect(tx(n.pos[0]), ty(n.pos[1]), Math.max(2, n.size[0] * s), Math.max(2, n.size[1] * s))
      }
      // 视口框
      ctx.strokeStyle = '#85b6ff'
      ctx.lineWidth = 1.5
      ctx.strokeRect(tx(va[0]), ty(va[1]), va[2] * s, va[3] * s)
      // 点击跳转
      this.minimap.onclick = (e) => {
        const rect = this.minimap!.getBoundingClientRect()
        const px = ((e.clientX - rect.left) * (this.minimap!.width / rect.width) - ox) / s + minX
        const py = ((e.clientY - rect.top) * (this.minimap!.height / rect.height) - oy) / s + minY
        this.centerOnPoint(px, py)
      }
      requestAnimationFrame(draw)
    }
    draw()
  }

  /**
   * 自检：确认主画布中心点确实能接收鼠标事件。
   * 历史上小地图被 CSS 拉满整屏并置顶，导致所有真实鼠标事件被它吞掉、画布完全无响应，
   * 而合成事件（dispatchEvent 直派 canvas）又会假通过 —— 这里做运行时兜底检测。
   */
  private verifyCanvasHittable(): void {
    requestAnimationFrame(() => {
      const rect = this.canvas.canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as HTMLElement | null
      if (!el || el === this.canvas.canvas) return
      // DOM 控件层（输入框/下拉等）在上层是正常的
      if (this.domLayer.contains(el)) return
      if (el instanceof HTMLCanvasElement) {
        el.style.pointerEvents = 'none'
        console.error(`[comfy] 画布被 canvas 遮挡，已放行鼠标事件: ${el.className || '(无 class)'}`)
      } else {
        console.error(`[comfy] 画布中心被元素遮挡: ${el.tagName}.${el.className || ''}`)
      }
    })
  }

  /** 把视图中心移到指定图坐标 */
  centerOnPoint(px: number, py: number): void {
    const ds = this.canvas.ds
    if (!ds) return
    ds.offset[0] = -px + this.canvas.canvas.width / 2 / ds.scale
    ds.offset[1] = -py + this.canvas.canvas.height / 2 / ds.scale
    this.canvas.setDirty(true, true)
  }

  /** 居中并自动缩放到能看全所有节点（ComfyUI 的 Fit view 行为） */
  fitView(): void {
    const allNodes = Object.values(nodesOf(this.graph))
    if (!allNodes.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of allNodes) {
      minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1])
      maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1])
    }
    const pad = 70
    const cw = this.canvas.canvas.clientWidth || this.canvas.canvas.width
    const ch = this.canvas.canvas.clientHeight || this.canvas.canvas.height
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    if (!cw || !ch || w <= 0 || h <= 0) return
    const ds = this.canvas.ds
    if (!ds) return
    const target = Math.min(cw / w, ch / h, 1.15)
    ds.scale = Math.max(0.15, Math.min(2, target))
    this.centerOnPoint((minX + maxX) / 2, (minY + maxY) / 2)
  }

  /** 端口颜色（菜单/对话框用） */
  static colorFor(type: string): string {
    return slotColor(type)
  }

  destroy(): void {
    this.destroyed = true
    if (this.renderRaf) cancelAnimationFrame(this.renderRaf)
    this.resizeObserver?.disconnect()
    this.graph.stop()
    this.domLayer.remove()
    void LiteGraph
  }
}
