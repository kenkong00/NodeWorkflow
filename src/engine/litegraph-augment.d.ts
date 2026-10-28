/**
 * litegraph.js 0.7.18 d.ts 缺口补齐
 * 下列成员运行时均真实存在（或来自 ComfyUI fork 的可选行为），仅官方 d.ts 未声明。
 * 统一在此扩展，避免业务代码散落 `as never` 断言。
 */
import type { LGraphNode, LGraphCanvas, SerializedLGraphNode } from 'litegraph.js'
import type { DOMWidget } from './widgets'

declare module 'litegraph.js' {
  interface LGraphNode {
    /** DOM 控件栈（litegraph 对 widget 对象无类型约束，DOMWidget 直接入栈） */
    widgets?: DOMWidget[]
    /** ComfyUI fork 提供的节点属性面板；原生 litegraph 0.7.18 无此方法，调用方需可选链兜底 */
    showConfigPanel?(): void
    /** serialize 接受 compact 参数（ComfyUI fork；原生实现忽略多余参数，行为等价） */
    serialize(compact?: boolean): SerializedLGraphNode
    /** 节点盒边框色（执行高亮用，未设置时回退引擎默认） */
    boxcolor?: string
    /** 内部脏标记 */
    _dirty?: boolean
    /** 按输出槽索引连接（slot 可为名称字符串） */
    connect(slot: number | string, targetNode: LGraphNode | number, targetSlot: number | string): unknown
    /** 从本节点输出按类型找目标节点第一个兼容且空闲的输入槽连接 */
    connectByType(slot: number | string, targetNode: LGraphNode | number, targetSlotType: string): unknown
    /** 本节点输入按类型找源节点第一个兼容且空闲的输出槽连接 */
    connectByTypeOutput(slot: number | string, sourceNode: LGraphNode | number, sourceSlotType: string): unknown
    /** 按类型查找输入槽索引，未找到 -1 */
    findInputSlotByType?(type: string, onlyFree?: boolean, typeMatchNoType?: boolean): number
    /** 按类型查找输出槽索引，未找到 -1 */
    findOutputSlotByType?(type: string, onlyFree?: boolean, typeMatchNoType?: boolean): number
  }

  interface LGraphCanvas {
    /** 画布视图状态：缩放/偏移/可视区域 */
    ds?: {
      scale: number
      offset: [number, number]
      reset?: () => void
    }
    /** 屏幕事件坐标 → 图坐标（litegraph 0.7.18 真实方法名；ComfyUI fork 才叫 convertEventToCanvas） */
    convertEventToCanvasOffset(e: { clientX: number; clientY: number }): [number, number]
    /** 把 clientX/clientY 换算并写入 e.canvasX/e.canvasY（litegraph 内部在事件处理开头调用） */
    adjustMouseEvent(e: MouseEvent): void
    /** 图坐标 → 屏幕偏移（反向换算，搜索框兜底定位用） */
    convertOffsetToCanvas?(offset: [number, number]): [number, number]
    /** 节点选中集合（id → node） */
    selected_nodes: Record<number, LGraphNode>
    /** 画布可视区域 [x, y, w, h] */
    visible_area: [number, number, number, number]
    /** 当前可见节点列表（命中检测传参） */
    visible_nodes: LGraphNode[]
    /** 拖线状态：按下端口的节点/输出槽/输入槽/槽索引 */
    connecting_node: LGraphNode | null
    connecting_output: { type: string } | null
    connecting_input: { type: string } | null
    connecting_slot: number | null
    /** 拖线起点图坐标（drawFrontCanvas 以它非空作为拖线渲染条件） */
    connecting_pos: [number, number] | null
    /** 拖线悬停高亮的输入端口位置 */
    _highlight_input: [number, number] | null
    /** 命中检测：事件点是否在节点标题栏盒内 */
    isOverNodeBox(node: LGraphNode, canvasX: number, canvasY: number): boolean
    /** 命中检测：返回命中的输入槽索引，未命中 -1 */
    isOverNodeInput(node: LGraphNode, canvasX: number, canvasY: number, pos?: [number, number]): number
    /** 命中检测：返回命中的输出槽索引，未命中 -1 */
    isOverNodeOutput(node: LGraphNode, canvasX: number, canvasY: number, pos?: [number, number]): number
    /** 中心对准某节点 */
    centerOnNode?(node: LGraphNode): void
    /** 拖线到空白松手 → 搜索框（实例级桥接，见 ComfyGraph.patchProcessMouseUp） */
    __onSearchBoxFromLink?: (f: import('./ComfyGraph').SearchBoxFilter) => void
    /** 右键/节点菜单选项工厂（litegraph 内部调用） */
    getCanvasMenuOptions?: () => unknown[]
    getNodeMenuOptions?: (node: LGraphNode) => unknown[]
    /** 连线拖拽中的脏标记 */
    dirty_canvas: boolean
    dirty_bgcanvas: boolean
  }
}
