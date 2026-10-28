/** 原生节点注册总入口 */
import { registry } from '../registry'
import { nativePrimitiveDefs, primitiveImpl, primitiveTypedImpl, rerouteImpl } from './primitives'
import {
  nativeTextDefs,
  apiProviderImpl,
  textProcessImpl,
  chatImpl,
  textDisplayImpl,
  numberDisplayImpl,
  textConcatImpl,
  textReplaceImpl
} from './text'
import { nativeMathDefs, mathImpl } from './math'
import {
  nativeImageDefs,
  loadImageImpl,
  loadImageMaskImpl,
  previewImageImpl,
  saveImageImpl,
  emptyImageImpl,
  imageScaleImpl,
  imageInvertImpl,
  imageBatchImpl,
  imageBlurImpl,
  imageSharpenImpl,
  getImageSizeImpl
} from './image'

/**
 * 实现表：一个实现可以被多个节点名复用。
 * 关键点：官方节点名（LoadImage / PreviewImage / ...）必须也注册实现，
 * 否则用户在节点库点的是官方节点，prompt 里就会混入「无原生实现」的节点
 * → 整个工作流被转发到 ComfyUI → 没开 ComfyUI 就报「无法连接」。
 */
const IMPLS: Record<string, () => unknown> = {
  // ---- 基础 ----
  PrimitiveNode: () => primitiveTypedImpl,
  Reroute: () => rerouteImpl,
  PrimitiveString: () => primitiveImpl,
  PrimitiveStringMultiline: () => primitiveImpl,
  PrimitiveInt: () => primitiveImpl,
  PrimitiveFloat: () => primitiveImpl,
  PrimitiveBoolean: () => primitiveImpl,
  TextInput: () => primitiveImpl,
  PromptRule: () => primitiveImpl,

  // ---- 文本 / LLM ----
  ApiProvider: () => apiProviderImpl,
  TextDisplay: () => textDisplayImpl,
  NumberDisplay: () => numberDisplayImpl,
  TextConcat: () => textConcatImpl,
  TextReplace: () => textReplaceImpl,
  TextProcess: () => textProcessImpl,
  ChatNode: () => chatImpl,

  // ---- 数学 ----
  MathOp: () => mathImpl,

  // ---- 图像（native 专属名）----
  LoadImageNative: () => loadImageImpl,
  PreviewImageNative: () => previewImageImpl,
  SaveImageNative: () => saveImageImpl,
  EmptyImageNative: () => emptyImageImpl,
  ImageScaleNative: () => imageScaleImpl,
  ImageInvertNative: () => imageInvertImpl,
  ImageBatchNative: () => imageBatchImpl,
  ImageBlurNative: () => imageBlurImpl,
  GetImageSizeNative: () => getImageSizeImpl,
  LoadImageMaskNative: () => loadImageMaskImpl,

  // ---- 图像（ComfyUI 官方节点名，同一实现）----
  LoadImage: () => loadImageImpl,
  LoadImageMask: () => loadImageMaskImpl,
  PreviewImage: () => previewImageImpl,
  SaveImage: () => saveImageImpl,
  EmptyImage: () => emptyImageImpl,
  ImageScale: () => imageScaleImpl,
  ImageInvert: () => imageInvertImpl,
  ImageBatch: () => imageBatchImpl,
  ImageBlur: () => imageBlurImpl,
  ImageSharpen: () => imageSharpenImpl
}

const DEFS: Array<{ name: string; def: Record<string, unknown> }> = [
  ...(nativePrimitiveDefs as Array<{ name: string; def: Record<string, unknown> }>),
  ...(nativeTextDefs as Array<{ name: string; def: Record<string, unknown> }>),
  ...(nativeMathDefs as Array<{ name: string; def: Record<string, unknown> }>),
  ...(nativeImageDefs as Array<{ name: string; def: Record<string, unknown> }>)
]

/**
 * 中文显示名覆盖：只对「本机能真正跑起来」的官方节点生效。
 * 其余 400+ 未实现的 ComfyUI 节点保留官方英文名（与 ComfyUI 对照一致，装插件后也不会错位）。
 * 注意：只改 display_name，不改 name —— name 是工作流 JSON 里的类型键，改了会打不开旧工作流。
 */
const DISPLAY_NAMES: Record<string, string> = {
  // 基础
  PrimitiveNode: '基础值',
  Reroute: '转接点',
  PrimitiveString: '字符串',
  PrimitiveStringMultiline: '多行字符串',
  PrimitiveInt: '整数',
  PrimitiveFloat: '浮点数',
  PrimitiveBoolean: '布尔值',
  // 图像
  LoadImage: '加载图像',
  LoadImageMask: '加载图像遮罩',
  PreviewImage: '预览图像',
  SaveImage: '保存图像',
  EmptyImage: '空图像',
  ImageScale: '缩放图像',
  ImageInvert: '图像反色',
  ImageBatch: '图像批次',
  ImageBlur: '图像模糊',
  ImageSharpen: '图像锐化'
}

/**
 * 与 native 版本功能完全重合的 ComfyUI 官方同名节点。
 * 这些节点在节点库里会和 `LoadImageNative` 等显示成两个一样的「加载图像」，
 * 很容易让人以为其中一个是坏的。这里保留注册（旧工作流 / ComfyUI 兼容需要），
 * 只是不在节点库里列出 —— **隐藏的是 native 专属名，显示官方同名节点**。
 *
 * 为什么显示官方名而不是 *Native：
 *  - 官方 `LoadImage` 的 image 输入声明带 `image_upload:true`，前端据此渲染出
 *    「下拉选已有图 + 上传按钮 + 缩略图」的完整形态，能真正加载图片；
 *  - `LoadImageNative` 用的是 `IMAGEUPLOAD` 控件，只有上传按钮、没有下拉和缩略图，
 *    体验上像「选不了图 / 加载不了」——之前误把官方节点隐藏、保留了它，是删反了。
 *  官方节点同样标记了 native（registerImpl 会置 native=true），所以「只显示本机可运行」
 *  过滤下也能正常出现；执行走同一份 loadImageImpl，无任何差异。
 */
const HIDDEN_DUPLICATES = ['LoadImageNative', 'LoadImageMaskNative', 'PreviewImageNative', 'SaveImageNative', 'EmptyImageNative']

let registered = false

export function registerNativeNodes(): void {
  if (registered) return
  registered = true
  for (const { def } of DEFS) {
    registry.registerDef({ ...(def as object), native: true, source: 'builtin' } as never, { allowOverride: true })
  }
  for (const [name, getImpl] of Object.entries(IMPLS)) {
    // 官方节点名也必须存在定义，否则 /object_info 里没有它
    if (!registry.has(name)) continue
    registry.registerImpl(name, getImpl() as never)
  }
  // 显示名放在实现注册之后：baseNodes.json 里的英文名会被这里覆盖成中文
  for (const [name, dn] of Object.entries(DISPLAY_NAMES)) {
    const def = registry.getDef(name)
    if (def && registry.hasNativeImpl(name)) def.display_name = dn
  }
  // 最后隐藏重复项：只影响节点库/搜索的可见性，不影响执行
  for (const name of HIDDEN_DUPLICATES) {
    const def = registry.getDef(name)
    if (def && registry.hasNativeImpl(name)) def.hidden = true
  }
}
