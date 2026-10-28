/**
 * 节点定义类型（与 ComfyUI /object_info V1 schema 完全兼容）
 * 逆向来源：ComfyUI v0.9.2 server.py node_info()
 */

/** 输入配置项（schema 中 [type, config] 的 config 部分） */
export interface InputConfig {
  default?: unknown
  min?: number
  max?: number
  step?: number
  round?: number | false
  /** 种子控件：fixed / increment / decrement / randomize */
  control_after_generate?: boolean
  /** 多行文本 */
  multiline?: boolean
  /** 下拉动态选项（由实现提供） */
  options?: string[]
  tooltip?: string
  /** 强制作为控件（即便类型通常渲染为端口） */
  forceInput?: boolean
  /** 图片上传控件 */
  image_upload?: boolean
  /** 高级参数（默认隐藏） */
  advanced?: boolean
  [k: string]: unknown
}

/** 单个输入定义：[类型, 配置] */
export type InputSpec = [string | string[], InputConfig]

export interface NodeInputGroups {
  required?: Record<string, InputSpec>
  optional?: Record<string, InputSpec>
  /** V3 hidden 组 */
  hidden?: Record<string, unknown>
}

/** /object_info 单节点输出（与 ComfyUI 对齐） */
export interface NodeDef {
  input: NodeInputGroups
  input_order?: Record<string, string[]>
  output: string[]
  output_is_list?: boolean[]
  output_name: string[]
  name: string
  display_name: string
  description: string
  python_module: string
  category: string
  output_node: boolean
  output_tooltips?: string[]
  deprecated?: boolean
  experimental?: boolean
  api_node?: boolean
  /** 新系统扩展：是否有 TS 原生实现 */
  native?: boolean
  /** 新系统扩展：节点来源 builtin / plugin:<name> */
  source?: string
  /**
   * 新系统扩展：不在节点库 / 右键搜索里列出。
   * 用于「同一功能有 native 实现 + ComfyUI 官方同名节点」时隐藏重复项，
   * 但实现仍然注册 —— 旧工作流里的官方节点名照样能打开、能执行。
   */
  hidden?: boolean
}

/** 执行上下文（传给节点实现） */
export interface ExecContext {
  /** 输入值：控件字面量 或 [nodeId, outputIndex] 已解析后的上游输出 */
  inputs: Record<string, unknown>
  /** 节点 id */
  nodeId: string
  /** 中断检查 */
  isCancelled?: () => boolean
  /** 进度回调 0..1 */
  onProgress?: (ratio: number) => void
}

/** 节点执行结果：与 RETURN_TYPES 对齐的元组 + ui 输出 */
export interface NodeOutput {
  /** ui 输出（图片/文本等展示数据，ComfyUI 的 output_ui） */
  ui?: Record<string, unknown>
  /** 供上游消费的数据（数组长度 = output 数量） */
  result: unknown[]
}

/** 原生节点实现 */
export interface NativeNodeImpl {
  /** 与 ComfyUI FUNCTION 同名 */
  execute: (ctx: ExecContext) => Promise<NodeOutput> | NodeOutput
}
