/**
 * LiteGraph 全局配置 —— 复刻 ComfyUI 的引擎参数（逆向自 LiteGraphGlobal.ts）
 */
import { LiteGraph, LGraphCanvas, LGraph, LGraphNode } from 'litegraph.js'
import { installNodeVisuals, NV } from './nodeDraw'

/** ComfyUI「Dark (Default)」端口类型色 */
export const SLOT_COLORS: Record<string, string> = {
  CLIP: '#FFD500',
  CLIP_VISION: '#A8DADC',
  CLIP_VISION_OUTPUT: '#ad7452',
  CONDITIONING: '#FFA931',
  CONTROL_NET: '#6EE7B7',
  IMAGE: '#64B5F6',
  LATENT: '#FF9CF9',
  MASK: '#81C784',
  MODEL: '#B39DDB',
  STYLE_MODEL: '#C2FFAE',
  VAE: '#FF6E6E',
  NOISE: '#B0B0B0',
  GUIDER: '#66FFFF',
  SAMPLER: '#ECB4B4',
  SIGMAS: '#CDFFCD',
  TAESD: '#DCC274',
  STRING: '#A0A0A0',
  INT: '#A0A0A0',
  FLOAT: '#A0A0A0',
  BOOLEAN: '#A0A0A0',
  API_CONFIG: '#FFB86B',
  CHAT_HISTORY: '#8BE9FD',
  IMAGEUPLOAD: '#64B5F6',
  COLOR: '#E06666'
}

/** 连线颜色（与端口一致，ComfyUI link_type_colors） */
LGraphCanvas.link_type_colors = { ...SLOT_COLORS, '-1': '#A86', number: '#AAA', node: '#DCA' }

let configured = false

/** LiteGraph 是 const 对象字面量（无法 augment namespace），统一断言为可写 Record 访问运行时常量 */
const LG = LiteGraph as unknown as Record<string, unknown>

export function configureLiteGraph(): void {
  if (configured) return
  configured = true

  // ---- 节点外观（照 ComfyUI 1.x 新版面重做，配色取自用户截图采样）----
  LG.NODE_DEFAULT_COLOR = NV.nodeTitle // 标题条底色
  LG.NODE_DEFAULT_BGCOLOR = NV.nodeBody // 主体底色
  LG.NODE_DEFAULT_BOXCOLOR = '#6b7280'
  LG.NODE_TITLE_COLOR = NV.titleText
  LG.NODE_SELECTED_TITLE_COLOR = NV.titleTextSelected
  LG.NODE_TEXT_COLOR = '#98a0ab' // 端口名称
  LG.NODE_TEXT_HIGHLIGHT_COLOR = '#FFFFFF'
  LG.NODE_SUBTEXT_SIZE = 12.5
  LG.NODE_TEXT_SIZE = 13
  LG.NODE_DEFAULT_SHAPE = LG.ROUND_SHAPE
  LG.NODE_BOX_OUTLINE_COLOR = '#FFF'
  LG.NODE_ERROR_COLOUR = '#E2564A'
  LG.NODE_OPACITY = 1
  LG.WIDGET_BGCOLOR = '#1a1f28'
  LG.WIDGET_OUTLINE_COLOR = '#2b323d'
  LG.WIDGET_TEXT_COLOR = '#d5dae1'
  LG.WIDGET_SECONDARY_TEXT_COLOR = '#8d949f'
  LG.LINK_COLOR = '#9A9'
  LG.EVENT_LINK_COLOR = '#A86'
  LG.CONNECTING_LINK_COLOR = '#AFA'
  LG.DEFAULT_SHADOW_COLOR = 'rgba(0,0,0,0.5)'
  LG.CLEAR_BACKGROUND_COLOR = NV.canvas
  LG.DEFAULT_GROUP_FONT_SIZE = 15

  // ---- 交互规则（与 ComfyUI 完全一致）----
  LG.allow_reconnect_links = true // 从已连输入拖动 = 搬移旧线
  LG.click_do_break_link_to = false
  LG.shift_click_do_break_link_from = false
  LG.ctrl_alt_click_do_break_link = true // Ctrl+Alt+点击断开
  LG.alt_drag_do_clone_nodes = true // Alt 拖动克隆节点
  LG.release_link_on_empty_shows_menu = false
  LG.alwaysSnapToGrid = false
  LG.CANVAS_GRID_SIZE = 10
  LG.NODE_MIN_WIDTH = 50
  LG.NODE_WIDTH = 220
  LG.NODE_SLOT_HEIGHT = 26 // 端口行高：与组件行 22+4 同栅格，纯端口行和组件行会自然对齐
  LG.NODE_TITLE_HEIGHT = 26 // 标题条（画在主体上方）
  LG.NODE_WIDGET_HEIGHT = 26
  LG.RENDER_NODES_IDS = false

  // 输入端口单连线（connectSlots 内自动替换旧线，引擎默认行为）
  ;(LGraph.prototype as unknown as Record<string, unknown>).validatedLinks = true

  // 序列化 widgets_values（npm 版基类默认 falsy，只有内置 const 节点手动开；
  // ComfyUI fork 在基类改为 true，否则保存工作流会丢全部控件值）
  ;(LGraphNode.prototype as unknown as Record<string, unknown>).serialize_widgets = true

  // 节点外形 + 组面板（ComfyUI 1.x 新版面）
  installNodeVisuals()
}

/** 节点按端口类型取色 */
export function slotColor(type: string): string {
  if (!type || type === '*') return '#9A9'
  const list = type.split(',').map((t) => t.trim())
  for (const t of list) {
    if (SLOT_COLORS[t]) return SLOT_COLORS[t]
  }
  return '#9A9'
}

/** 端口形状：ComfyUI 全部为实心圆点 */
export function slotShape(): 'default' | 'box' | 'round' | 'card' {
  return 'default'
}

export { LiteGraph, LGraphCanvas, LGraph, LGraphNode }
