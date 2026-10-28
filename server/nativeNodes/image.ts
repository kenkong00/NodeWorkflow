/**
 * 图像节点（原生实现，基于 sharp）
 *
 * 图像在工作流内以「文件引用」传递：{ filename, subfolder, type }，
 * 与 ComfyUI 的 IMAGE 传递哲学一致（不搬运像素，只传引用 + 尺寸）。
 *
 * 重要：既提供 native 专属名（LoadImageNative…），也用同一实现在官方节点名
 * （LoadImage / PreviewImage / SaveImage / EmptyImage / ImageScale / ImageInvert /
 * ImageBatch / ImageBlur / ImageSharpen / LoadImageMask）下注册一份。
 * 否则用户在节点库点官方节点时，整个 prompt 会被判定为「无原生实现」而转发给 ComfyUI。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import sharp from 'sharp'
import type { ExecContext, NativeNodeImpl } from '../registry/types'

export const ROOT = path.resolve(process.cwd())
export const INPUT_DIR = path.join(ROOT, 'input')
export const OUTPUT_DIR = path.join(ROOT, 'output')
fs.mkdirSync(INPUT_DIR, { recursive: true })
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

export interface ImageRef {
  filename: string
  subfolder: string
  type: 'input' | 'output' | 'temp'
}

/**
 * 归一化图像输入：
 *  - LoadImage 的 image 控件值是字符串文件名（与 ComfyUI 一致）→ 转成 input 目录引用
 *  - 上游节点的输出是 { filename, subfolder, type } 对象 → 直接使用
 *  - 批量输出的第一项（数组）→ 取第一个
 */
function asImage(v: unknown): ImageRef {
  if (Array.isArray(v) && v.length) return asImage(v[0])
  if (typeof v === 'string' && v.trim()) {
    return { filename: path.basename(v.trim()), subfolder: '', type: 'input' }
  }
  if (v && typeof v === 'object') {
    const o = v as Partial<ImageRef>
    if (typeof o.filename === 'string' && o.filename) {
      return { filename: o.filename, subfolder: o.subfolder || '', type: (o.type as ImageRef['type']) || 'output' }
    }
  }
  throw new Error('输入不是有效的图像：请先在节点上选择/上传图片，或把上游 IMAGE 输出连到本节点')
}

/** EmptyImage 的 color 在 ComfyUI 里是 0xRRGGBB 整数 */
function intColorToHex(v: unknown): string {
  if (typeof v === 'string') return v
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '#000000'
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
}

/** ComfyUI 与 sharp 的缩放算法名映射 */
function kernelOf(method: string): string {
  const map: Record<string, string> = {
    nearest: 'nearest',
    'nearest-exact': 'nearest',
    bilinear: 'linear',
    area: 'cubic',
    bicubic: 'cubic',
    lanczos: 'lanczos3',
    lanczos2: 'lanczos2',
    lanczos3: 'lanczos3'
  }
  return map[method] || 'lanczos3'
}

function resolvePath(ref: ImageRef): string {
  const base = ref.type === 'input' ? INPUT_DIR : OUTPUT_DIR
  const p = path.join(base, ref.subfolder || '', ref.filename)
  if (!p.startsWith(base)) throw new Error('非法文件路径')
  if (!fs.existsSync(p)) {
    throw new Error(`找不到图像文件：${ref.type}/${ref.subfolder ? ref.subfolder + '/' : ''}${ref.filename}（请重新上传）`)
  }
  return p
}

async function meta(ref: ImageRef): Promise<{ width: number; height: number }> {
  const m = await sharp(resolvePath(ref)).metadata()
  return { width: m.width ?? 0, height: m.height ?? 0 }
}

/** 结果里统一带尺寸，前端显示"看不懂"的问题靠它 + 缩略图解决 */
async function describe(ref: ImageRef): Promise<ImageRef & { width: number; height: number }> {
  const m = await meta(ref)
  return { ...ref, ...m }
}

/** LoadImage：从 input/ 目录读取（前端上传后传来字符串文件名或引用对象） */
export const loadImageImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const info = await describe(ref)
    // ComfyUI 的 LoadImage 有 IMAGE + MASK 两个输出
    return { result: [info, { ...ref, ...info, mask: true }], ui: { images: [info] } }
  }
}

/** LoadImageMask：以 mask 形式加载 */
export const loadImageMaskImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const m = await meta(ref)
    return { result: [{ ...ref, ...m, channel: String(ctx.inputs.channel ?? 'alpha') }] }
  }
}

/** PreviewImage：执行后在节点内显示图片 */
export const previewImageImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.images ?? ctx.inputs.image)
    const info = await describe(ref)
    return { result: [info], ui: { images: [info] } }
  }
}

/** SaveImage：保存到 output/ 并返回引用 */
export const saveImageImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.images ?? ctx.inputs.image)
    const prefix = String(ctx.inputs.filename_prefix ?? 'ComfyUI')
    const src = resolvePath(ref)
    const ext = path.extname(ref.filename) || '.png'
    const name = `${prefix.replace(/[^\w\-]/g, '_')}_${Date.now().toString(36)}${ext}`
    const dest = path.join(OUTPUT_DIR, name)
    fs.copyFileSync(src, dest)
    const saved = await describe({ filename: name, subfolder: '', type: 'output' })
    return { result: [saved], ui: { images: [saved], text: [`已保存：output/${name}`] } }
  }
}

/** EmptyImage：生成纯色图 */
export const emptyImageImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const width = Math.max(1, Math.min(8192, Number(ctx.inputs.width ?? 512)))
    const height = Math.max(1, Math.min(8192, Number(ctx.inputs.height ?? 512)))
    const color = intColorToHex(ctx.inputs.color)
    const batch = Math.max(1, Math.min(64, Number(ctx.inputs.batch_size ?? 1)))
    const name = `empty_${Date.now().toString(36)}.png`
    const dest = path.join(OUTPUT_DIR, name)
    await sharp({ create: { width, height, channels: 4, background: color } }).png().toFile(dest)
    const info = { filename: name, subfolder: '', type: 'output' as const, width, height }
    const results: unknown[] = []
    for (let i = 0; i < batch; i++) results.push(info)
    return { result: [results], ui: { images: [info] } }
  }
}

/** ImageScale：缩放到指定宽高（宽或高为 0 时按比例） */
export const imageScaleImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const src = resolvePath(ref)
    const m = await sharp(src).metadata()
    let width = Number(ctx.inputs.width ?? 512)
    let height = Number(ctx.inputs.height ?? 512)
    const sw = m.width || 1
    const sh = m.height || 1
    if (!width && !height) { width = sw; height = sh }
    else if (!width) width = Math.round((height * sw) / sh)
    else if (!height) height = Math.round((width * sh) / sw)
    const method = String(ctx.inputs.upscale_method ?? 'lanczos3')
    const crop = String(ctx.inputs.crop ?? 'disabled')
    const name = `scaled_${Date.now().toString(36)}.png`
    const dest = path.join(OUTPUT_DIR, name)
    await sharp(src)
      .resize(width, height, {
        kernel: kernelOf(method) as never,
        fit: crop === 'center' ? 'cover' : 'fill',
        position: 'centre'
      })
      .png()
      .toFile(dest)
    return { result: [{ filename: name, subfolder: '', type: 'output', width, height }] }
  }
}

/** ImageInvert：反色 */
export const imageInvertImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const name = `invert_${Date.now().toString(36)}.png`
    await sharp(resolvePath(ref)).negate({ alpha: false }).png().toFile(path.join(OUTPUT_DIR, name))
    return { result: [await describe({ filename: name, subfolder: '', type: 'output' })] }
  }
}

/** ImageBatch：水平拼接两张图 */
export const imageBatchImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const a = asImage(ctx.inputs.image1)
    const b = asImage(ctx.inputs.image2)
    const ma = await meta(a)
    const mb = await meta(b)
    const bufA = await sharp(resolvePath(a)).png().toBuffer()
    const bufB = await sharp(resolvePath(b)).png().toBuffer()
    const height = Math.max(ma.height, mb.height)
    const width = ma.width + mb.width
    const name = `batch_${Date.now().toString(36)}.png`
    await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
      .composite([
        { input: bufA, left: 0, top: 0 },
        { input: bufB, left: ma.width, top: 0 }
      ])
      .png()
      .toFile(path.join(OUTPUT_DIR, name))
    return { result: [{ filename: name, subfolder: '', type: 'output', width, height }] }
  }
}

/** ImageBlur：高斯模糊 */
export const imageBlurImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const sigma = Math.max(0.1, Number(ctx.inputs.sigma ?? 1))
    const name = `blur_${Date.now().toString(36)}.png`
    await sharp(resolvePath(ref)).blur(sigma).png().toFile(path.join(OUTPUT_DIR, name))
    return { result: [await describe({ filename: name, subfolder: '', type: 'output' })] }
  }
}

/** ImageSharpen：锐化 */
export const imageSharpenImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const sigma = Math.max(0.1, Number(ctx.inputs.sigma ?? 1))
    const name = `sharpen_${Date.now().toString(36)}.png`
    await sharp(resolvePath(ref)).sharpen({ sigma }).png().toFile(path.join(OUTPUT_DIR, name))
    return { result: [await describe({ filename: name, subfolder: '', type: 'output' })] }
  }
}

/** 读取图像尺寸：输出 width / height（配合「数值显示」节点可看到结果） */
export const getImageSizeImpl: NativeNodeImpl = {
  execute: async (ctx: ExecContext) => {
    const ref = asImage(ctx.inputs.image)
    const m = await meta(ref)
    return {
      result: [m.width, m.height],
      ui: { text: [`${m.width} × ${m.height} 像素`] }
    }
  }
}

/** 输入目录中可用图片列表（LoadImage 下拉选项动态填充） */
export function listInputImages(): string[] {
  try {
    return fs
      .readdirSync(INPUT_DIR)
      .filter((f) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f))
      .sort()
  } catch {
    return []
  }
}

const IMAGE_OUT = { output: ['IMAGE'], output_name: ['IMAGE'] }
const IMAGE_IN = { required: { image: ['IMAGE', {}] } }

export const nativeImageDefs = [
  {
    name: 'LoadImageNative',
    def: {
      input: { required: { image: ['IMAGEUPLOAD', {}] } },
      output: ['IMAGE', 'MASK'],
      output_name: ['IMAGE', 'MASK'],
      name: 'LoadImageNative',
      display_name: '加载图像',
      description: '从本地加载图像（上传或选择已有文件），并在节点上显示缩略图。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'PreviewImageNative',
    def: {
      input: { required: { images: ['IMAGE', {}] } },
      output: [],
      output_name: [],
      name: 'PreviewImageNative',
      display_name: '预览图像',
      description: '在节点上预览图像（执行后显示，含真实像素尺寸）。',
      python_module: 'native.image',
      category: 'image',
      output_node: true
    }
  },
  {
    name: 'SaveImageNative',
    def: {
      input: {
        required: { images: ['IMAGE', {}] },
        optional: { filename_prefix: ['STRING', { default: 'ComfyUI' }] }
      },
      output: [],
      output_name: [],
      name: 'SaveImageNative',
      display_name: '保存图像',
      description: '保存图像到 output 目录。',
      python_module: 'native.image',
      category: 'image',
      output_node: true
    }
  },
  {
    name: 'EmptyImageNative',
    def: {
      input: {
        required: {
          width: ['INT', { default: 512, min: 1, max: 8192 }],
          height: ['INT', { default: 512, min: 1, max: 8192 }],
          batch_size: ['INT', { default: 1, min: 1, max: 64 }]
        },
        optional: { color: ['COLOR', { default: '#000000' }] }
      },
      ...IMAGE_OUT,
      name: 'EmptyImageNative',
      display_name: '空图像',
      description: '生成指定尺寸的纯色图像。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'ImageScaleNative',
    def: {
      input: {
        ...IMAGE_IN,
        required: {
          image: ['IMAGE', {}],
          width: ['INT', { default: 512, min: 0, max: 8192 }],
          height: ['INT', { default: 512, min: 0, max: 8192 }]
        },
        optional: {
          upscale_method: [['nearest', 'lanczos2', 'lanczos3', 'bilinear', 'bicubic'], { default: 'lanczos3' }]
        }
      },
      ...IMAGE_OUT,
      name: 'ImageScaleNative',
      display_name: '缩放图像',
      description: '将图像缩放到指定宽高（宽或高填 0 表示按比例）。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'ImageInvertNative',
    def: {
      input: IMAGE_IN,
      ...IMAGE_OUT,
      name: 'ImageInvertNative',
      display_name: '反色',
      description: '图像反色。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'ImageBatchNative',
    def: {
      input: { required: { image1: ['IMAGE', {}], image2: ['IMAGE', {}] } },
      ...IMAGE_OUT,
      name: 'ImageBatchNative',
      display_name: '图像拼接',
      description: '水平拼接两张图像。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'ImageBlurNative',
    def: {
      input: {
        required: {
          image: ['IMAGE', {}],
          sigma: ['FLOAT', { default: 2, min: 0.1, max: 50, step: 0.1 }]
        }
      },
      ...IMAGE_OUT,
      name: 'ImageBlurNative',
      display_name: '图像模糊',
      description: '高斯模糊（sigma 越大越糊）。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'GetImageSizeNative',
    def: {
      input: IMAGE_IN,
      output: ['INT', 'INT'],
      output_name: ['width', 'height'],
      name: 'GetImageSizeNative',
      display_name: '图像尺寸',
      description: '输出图像的宽和高（INT），可连到「数值显示」或「数学运算」。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  },
  {
    name: 'LoadImageMaskNative',
    def: {
      input: { required: { image: ['IMAGEUPLOAD', {}], channel: [['alpha', 'red', 'green', 'blue'], { default: 'alpha' }] } },
      output: ['MASK'],
      output_name: ['MASK'],
      name: 'LoadImageMaskNative',
      display_name: '加载图像蒙版',
      description: '以 MASK 类型加载图像。',
      python_module: 'native.image',
      category: 'image',
      output_node: false
    }
  }
]
