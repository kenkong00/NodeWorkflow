/**
 * 画布视觉层（照 ComfyUI 1.x 新版面重做）
 *
 * 只覆写两处原型方法，不碰 litegraph 的布局/命中/连线逻辑：
 *  - drawNodeShape  → 节点外形（标题条 + 主体 + 节点 id 角标 + 选中描边）
 *  - drawGroups     → 组面板（半透明蓝色区域 + 标题条 + 节点数角标）
 *
 * 关键前提：节点的 pos 始终是「主体左上角」，标题条画在 y = -TITLE_H 处，
 * 与 litegraph 的命中测试（isPointInside 会把 title 高度算进去）保持一致。
 */
import { LGraphCanvas, LiteGraph } from 'litegraph.js'

/** 画布配色（从用户提供的 ComfyUI 截图采样：画布 #030405、组 #152633、节点体 #13171d） */
export const NV = {
  canvas: '#07080b',
  nodeBody: '#12161d',
  nodeBodyAlt: '#171d26',
  nodeTitle: '#171d26',
  nodeBorder: 'rgba(255,255,255,0.075)',
  nodeBorderHover: 'rgba(255,255,255,0.18)',
  nodeSelected: '#6ea8e8',
  titleText: '#cbd2dc',
  titleTextSelected: '#f2f6fb',
  stateDot: 'rgba(255,255,255,0.26)',
  idBadgeBg: '#0b0e13',
  idBadgeText: '#78828f',
  warn: '#e8a54b',
  groupPanel: 'rgba(23,45,60,0.55)',
  groupHeader: '#152633',
  groupBorder: 'rgba(84,124,158,0.42)',
  groupBorderActive: '#4f93c8',
  groupTitle: '#4f93c8',
  groupCount: 'rgba(160,190,214,0.55)',
  portRing: '#0b0e13'
} as const

export const TITLE_H = 26
export const GROUP_HEADER_H = 30

type Ctx2D = CanvasRenderingContext2D

/** 圆角矩形（不依赖 ctx.roundRect，兼容旧内核） */
export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): void {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r]
  const max = Math.min(w, h) / 2
  const a = Math.min(tl, max)
  const b = Math.min(tr, max)
  const c = Math.min(br, max)
  const d = Math.min(bl, max)
  ctx.beginPath()
  ctx.moveTo(x + a, y)
  ctx.lineTo(x + w - b, y)
  ctx.arcTo(x + w, y, x + w, y + b, b)
  ctx.lineTo(x + w, y + h - c)
  ctx.arcTo(x + w, y + h, x + w - c, y + h, c)
  ctx.lineTo(x + d, y + h)
  ctx.arcTo(x, y + h, x, y + h - d, d)
  ctx.lineTo(x, y + a)
  ctx.arcTo(x, y, x + a, y, a)
  ctx.closePath()
}

/** 文本按最大宽度截断（加省略号） */
function fitText(ctx: Ctx2D, text: string, maxW: number): string {
  if (maxW <= 0) return ''
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

interface ShapeNode {
  pos: Float32Array | number[]
  size: Float32Array | number[]
  id?: number | string
  title?: string
  color?: string
  bgcolor?: string
  flags?: { collapsed?: boolean }
  has_errors?: boolean
  is_selected?: boolean
  mouseOver?: boolean
  _collapsed_width?: number
  mode?: number
}

let installed = false

export function installNodeVisuals(): void {
  if (installed) return
  installed = true
  const proto = LGraphCanvas.prototype as unknown as Record<string, unknown>

  // ---------------- 节点外形 ----------------
  proto.drawNodeShape = function (
    this: LGraphCanvas,
    node: ShapeNode,
    ctx: Ctx2D,
    size: number[],
    fgcolor: string,
    bgcolor: string
  ): void {
    const titleH = TITLE_H
    const collapsed = !!node.flags?.collapsed
    const w = collapsed ? node._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH || 120 : size[0]
    const h = collapsed ? titleH : size[1] + titleH
    const body = bgcolor || NV.nodeBody
    const titleBg = fgcolor || NV.nodeTitle
    const selected = !!node.is_selected
    const hover = !!node.mouseOver && !selected
    const executing = !!(node as unknown as { __executing?: boolean }).__executing
    const radius = 9

    ctx.save()
    ctx.shadowColor = 'transparent'

    // 整体（标题 + 主体）先铺标题色，再把主体盖上去——外圆角天然统一
    roundRect(ctx, 0, -titleH, w, h, collapsed ? radius : [radius, radius, radius, radius])
    ctx.fillStyle = titleBg
    ctx.fill()

    if (!collapsed) {
      roundRect(ctx, 0, 0, w, size[1], [0, 0, radius, radius])
      ctx.fillStyle = body
      ctx.fill()
      // 标题条与主体之间的细分隔线（ComfyUI 1.x 同款，让标题区有边界）
      ctx.beginPath()
      ctx.moveTo(1, 0.5)
      ctx.lineTo(w - 1, 0.5)
      ctx.strokeStyle = 'rgba(255,255,255,0.055)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // 描边
    roundRect(ctx, 0.5, -titleH + 0.5, w - 1, h - 1, radius)
    ctx.strokeStyle = executing
      ? '#4f9cf0'
      : selected
        ? NV.nodeSelected
        : hover
          ? NV.nodeBorderHover
          : NV.nodeBorder
    ctx.lineWidth = executing ? 2 : selected ? 1.6 : 1
    ctx.stroke()

    // 选中 / 执行中：外发光
    if (selected || executing) {
      const glow = executing ? '79,156,240' : '110,168,232'
      ctx.save()
      ctx.shadowColor = `rgba(${glow},0.55)`
      ctx.shadowBlur = executing ? 18 : 14
      ctx.strokeStyle = `rgba(${glow},0.6)`
      ctx.lineWidth = 1
      roundRect(ctx, 0.5, -titleH + 0.5, w - 1, h - 1, radius)
      ctx.stroke()
      ctx.restore()
    }

    // 标题：状态点 + 文本
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const cy = -titleH / 2 + 0.5
    ctx.beginPath()
    ctx.arc(13, cy, 3.4, 0, Math.PI * 2)
    ctx.fillStyle = node.mode === 4 ? NV.warn : NV.stateDot
    ctx.fill()

    ctx.font = '13px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = selected ? NV.titleTextSelected : NV.titleText
    const maxTextW = w - 44
    ctx.fillText(fitText(ctx, String(node.title ?? ''), maxTextW), 24, cy)

    // 节点 id 角标（主体右上角外侧，ComfyUI 1.x 同款）
    if (!collapsed) {
      const idText = `#${node.id ?? ''}`
      ctx.font = '10.5px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
      const bw = ctx.measureText(idText).width + 12
      const bh = 15
      const bx = w - bw - 1
      const by = -titleH - bh - 3
      roundRect(ctx, bx, by, bw, bh, 4)
      ctx.fillStyle = NV.idBadgeBg
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = node.has_errors ? '#ff8a8a' : NV.idBadgeText
      ctx.textAlign = 'center'
      ctx.fillText(idText, bx + bw / 2, by + bh / 2 + 0.5)

      // 错误 / 警告指示
      if (node.has_errors) {
        ctx.beginPath()
        ctx.arc(bx - 7, by + bh / 2, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#e2564a'
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // ---------------- 组面板 ----------------
  proto.drawGroups = function (this: LGraphCanvas, _canvas: HTMLCanvasElement, ctx: Ctx2D): void {
    const graph = this.graph as unknown as { _groups: GroupLike[] }
    if (!graph?._groups?.length) return
    const scale = this.ds?.scale || 1
    const visible = (this as unknown as { visible_area: Float32Array }).visible_area

    for (const g of graph._groups) {
      const [x, y] = g._pos
      const [w, h] = g._size
      if (visible && !overlap(visible, x, y, w, h)) continue
      const active = (this as unknown as { selected_group?: unknown }).selected_group === g
      const accent = g.__accent || (g as GroupLike).color || NV.groupTitle
      const head = GROUP_HEADER_H
      const radius = 12

      // 面板（半透明蓝，透出画布点阵）
      ctx.save()
      roundRect(ctx, x, y, w, h, radius)
      ctx.fillStyle = NV.groupPanel
      ctx.fill()

      // 标题条
      roundRect(ctx, x, y, w, Math.min(head, h), [radius, radius, 0, 0])
      ctx.fillStyle = NV.groupHeader
      ctx.fill()

      // 边框
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius)
      ctx.strokeStyle = active ? NV.groupBorderActive : NV.groupBorder
      ctx.lineWidth = active ? 1.6 : 1
      ctx.stroke()

      // 标题文本
      if (scale > 0.28) {
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.font = '15px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
        ctx.fillStyle = accent
        const nodes = g._nodes || []
        const countText = `#${nodes.length} nodes`
        ctx.font = '11px Inter, "Segoe UI", sans-serif'
        const countW = ctx.measureText(countText).width
        ctx.font = '15px Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
        const titleMax = w - countW - 34
        ctx.fillText(fitText(ctx, String(g.title || '组'), titleMax), x + 13, y + head / 2 + 1)

        // 节点数角标
        ctx.font = '11px Inter, "Segoe UI", sans-serif'
        ctx.fillStyle = NV.groupCount
        ctx.textAlign = 'right'
        ctx.fillText(countText, x + w - 12, y + head / 2 + 1)
      }
      ctx.restore()
    }
  }
}

interface GroupLike {
  _pos: Float32Array
  _size: Float32Array
  title?: string
  color?: string
  _nodes?: unknown[]
  __accent?: string
}

function overlap(area: Float32Array, x: number, y: number, w: number, h: number): boolean {
  return !(area[0] > x + w || area[0] + area[2] < x || area[1] > y + h || area[1] + area[3] < y)
}
