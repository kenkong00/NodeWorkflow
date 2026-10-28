/**
 * DOM 控件工厂 —— ComfyUI 1.x 风格的「胶囊行」组件
 *
 * 一行组件 = 一个带描边的圆角胶囊：  [◀] 名称 ......... 值 [▶]
 *  - 左右内边距固定 8px、行高 26px，全站统一 → 所有节点组件天然对齐
 *  - 数字/下拉/种子类组件带 ◀ ▶ 微调按钮（ComfyUI 同款：点一下 = 减/加一档、切换下一项）
 *  - 名称左侧预留隐藏输入端口位（.lg-port），鼠标划过组件行时由画布层点亮，可直接拖出连线
 *  - 所有置灰态统一走 .is-linked（被连线取值 / 节点被忽略）
 */
import type { LGraphNode } from 'litegraph.js'

/** 内联 SVG 图标（stroke 风格，颜色继承 currentColor） */
export const WIDGET_ICONS: Record<string, string> = {
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'
}

export function svgIcon(name: string, size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${WIDGET_ICONS[name] || ''}</svg>`
}

/** 胶囊行内的小三角（◀ / ▶） */
const caret = (dir: -1 | 1): string =>
  `<svg viewBox="0 0 6 9" aria-hidden="true"><path d="${dir < 0 ? 'M5.4 0.7 1 4.5l4.4 3.8Z' : 'M0.6 0.7 5 4.5 0.6 8.3Z'}"/></svg>`

export interface DOMWidgetOptions {
  serialize?: (value: unknown) => unknown
  afterSerialize?: (value: unknown) => void
  minWidth?: number
  height?: number
  /** 弹性控件（图片）：宽度贴满节点，高度吃掉节点剩余空间 */
  flexible?: boolean
  minHeight?: number
}

export class DOMWidget {
  type = 'dom'
  name: string
  value: unknown
  element: HTMLElement | null = null
  options: DOMWidgetOptions
  y = 0
  last_y = 0
  disabled = false
  width = 0
  syncDom?: () => void
  /** 胶囊行的 ◀ ▶ 回调（数字 +/-、下拉切换） */
  step?: (dir: -1 | 1) => void
  /**
   * 序列化时占用的 widgets_values 槽位数（默认 1）。
   * ComfyUI 里 seed 类输入是「种子 + 生成后控制」两个值，我们把它做成一个控件，
   * 但序列化必须仍然占两槽，否则读真实 ComfyUI 工作流时后面所有参数都会错位。
   */
  valueSlots = 1
  /** 读取附加槽位的值（第 2..valueSlots 个） */
  getExtraValues?: () => unknown[]
  /** 写入附加槽位的值 */
  setExtraValues?: (vals: unknown[]) => void
  private _cleanups: Array<() => void> = []

  constructor(name: string, type: string, value: unknown, element: HTMLElement, options: DOMWidgetOptions = {}) {
    this.name = name
    this.type = type
    this.value = value
    this.element = element
    this.options = options
  }

  computeSize(width: number): [number, number] {
    if (this.options.flexible) return [this.width || width, this.options.minHeight || 120]
    const real = this.element ? this.element.offsetHeight : 0
    return [this.width || width, real || this.options.height || 26]
  }

  onRemove(): void {
    for (const fn of this._cleanups) fn()
    this._cleanups = []
    this.element?.remove()
    this.element = null
  }

  addCleanup(fn: () => void): void {
    this._cleanups.push(fn)
  }
}

function stopPropagation(el: HTMLElement): void {
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'wheel', 'contextmenu', 'click'] as const) {
    el.addEventListener(ev, (e) => e.stopPropagation())
  }
}

/** 兼容旧工作流：图片控件的值可能是 { filename, subfolder, type } 对象，统一取文件名 */
export function normalizeImageValue(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as { filename?: unknown }
    return typeof o.filename === 'string' ? o.filename : ''
  }
  return v == null ? '' : String(v)
}

export async function uploadImageFile(file: File): Promise<string> {
  const res = await fetch('/upload/image', {
    method: 'POST',
    headers: { 'x-filename': file.name },
    body: file
  })
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`)
  const data = (await res.json()) as { name?: string }
  return data.name || file.name
}

// ==================== 胶囊行骨架 ====================

interface RowHandle {
  row: HTMLElement
  labelEl: HTMLElement
  /** 值所在的一格（输入框/下拉/开关塞这里） */
  slot: HTMLElement
  setStep: (fn: ((dir: -1 | 1) => void) | null) => void
}

/**
 * 造一个胶囊行。
 * @param opts.step 是否显示左右微调三角（不给就不显示）
 * @param opts.align 值对齐方式（默认右对齐，ComfyUI 同款；单行文本用左对齐）
 */
function baseRow(label: string, opts: { steppable?: boolean; align?: 'left' | 'right' } = {}): RowHandle {
  const row = document.createElement('div')
  row.className = 'lg-dom-widget lg-row'

  // 隐藏输入端口（鼠标划过时浮现，可直接拖出连线）
  const port = document.createElement('span')
  port.className = 'lg-port'
  row.appendChild(port)

  const prev = document.createElement('button')
  prev.className = 'lg-step lg-prev'
  prev.type = 'button'
  prev.tabIndex = -1
  prev.innerHTML = caret(-1)
  prev.title = '减小 / 上一项'

  const next = document.createElement('button')
  next.className = 'lg-step lg-next'
  next.type = 'button'
  next.tabIndex = -1
  next.innerHTML = caret(1)
  next.title = '增大 / 下一项'

  const labelEl = document.createElement('span')
  labelEl.className = 'lg-label'
  labelEl.textContent = label
  labelEl.title = label

  const slot = document.createElement('span')
  slot.className = 'lg-value'
  if (opts.align === 'left') slot.classList.add('is-left')

  if (opts.steppable) row.append(prev, labelEl, slot, next)
  else row.append(labelEl, slot)

  const setStep = (fn: ((dir: -1 | 1) => void) | null) => {
    row.classList.toggle('has-step', !!fn)
    if (!fn) return
    prev.addEventListener('click', () => fn(-1))
    next.addEventListener('click', () => fn(1))
  }

  return { row, labelEl, slot, setStep }
}

/** 把值元素塞进胶囊行，并保留微调三角 */
function mountField(handle: RowHandle, field: HTMLElement, steppable?: (dir: -1 | 1) => void): void {
  field.classList.add('lg-field')
  handle.slot.appendChild(field)
  if (steppable) handle.setStep(steppable)
}

/** 统一置灰（被连线取值 / 节点被忽略） */
function markDisabled(row: HTMLElement, d: boolean): void {
  row.classList.toggle('is-linked', d)
}

/** 让输入框回车后失焦（避免回车被画布其它快捷键吃掉） */
function commitOnEnter(el: HTMLInputElement | HTMLTextAreaElement): void {
  el.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent
    if (ev.key === 'Enter' && !ev.shiftKey && el.tagName === 'INPUT') {
      ev.preventDefault()
      el.blur()
    }
  })
}

// ==================== 具体控件 ====================

/** 数字控件（INT/FLOAT） */
export function createNumberWidget(
  name: string,
  value: number,
  opts: { min?: number; max?: number; step?: number; label?: string }
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const step = opts.step ?? 1
  const handle = baseRow(opts.label || name, { steppable: true })
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  if (opts.min !== undefined) input.min = String(opts.min)
  if (opts.max !== undefined) input.max = String(opts.max)
  input.step = String(step)
  commitOnEnter(input)

  const clamp = (v: number) => {
    let n = v
    if (opts.min !== undefined) n = Math.max(opts.min, n)
    if (opts.max !== undefined) n = Math.min(opts.max, n)
    return Number(n.toFixed(6))
  }
  const apply = (v: number) => {
    widget.value = clamp(v)
    input.value = String(widget.value)
  }
  const widget = new DOMWidget(name, 'dom-number', value, handle.row, { height: 26 })
  mountField(handle, input, (dir) => apply(Number(widget.value ?? 0) + dir * step))
  input.addEventListener('input', () => {
    const v = Number(input.value)
    if (!Number.isNaN(v)) widget.value = clamp(v)
  })
  widget.syncDom = () => {
    input.value = String(widget.value ?? 0)
  }
  const setDisabled = (d: boolean) => {
    input.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/** 滑块控件（FLOAT with display:slider） */
export function createSliderWidget(
  name: string,
  value: number,
  opts: { min: number; max: number; step: number; label?: string }
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const handle = baseRow(opts.label || name)
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(opts.min)
  range.max = String(opts.max)
  range.step = String(opts.step)
  range.value = String(value)
  const valEl = document.createElement('span')
  valEl.className = 'lg-num'
  valEl.textContent = String(value)
  handle.slot.appendChild(range)
  handle.slot.appendChild(valEl)
  handle.slot.classList.add('with-slider')

  const widget = new DOMWidget(name, 'dom-slider', value, handle.row, { height: 26 })
  range.addEventListener('input', () => {
    widget.value = Number(range.value)
    valEl.textContent = String(widget.value)
  })
  widget.syncDom = () => {
    range.value = String(widget.value ?? 0)
    valEl.textContent = String(widget.value ?? 0)
  }
  const setDisabled = (d: boolean) => {
    range.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/** 文本控件（STRING）；multiline → 带标题的文本块 */
export function createTextWidget(
  name: string,
  value: string,
  opts: { multiline?: boolean; label?: string }
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  if (opts.multiline) {
    const box = document.createElement('div')
    box.className = 'lg-dom-widget lg-block'
    const head = document.createElement('div')
    head.className = 'lg-block-head'
    const port = document.createElement('span')
    port.className = 'lg-port'
    const labelEl = document.createElement('span')
    labelEl.className = 'lg-label'
    labelEl.textContent = opts.label || name
    head.append(port, labelEl)
    const area = document.createElement('textarea')
    area.className = 'lg-field lg-area'
    area.rows = 5
    area.value = value ?? ''
    box.append(head, area)
    const widget = new DOMWidget(name, 'dom-text', value ?? '', box, { height: 110 })
    area.addEventListener('input', () => {
      widget.value = area.value
    })
    widget.syncDom = () => { area.value = widget.value == null ? '' : String(widget.value) }
    const setDisabled = (d: boolean) => {
      area.disabled = d
      markDisabled(box, d)
    }
    stopPropagation(box)
    return { widget, setDisabled }
  }

  const handle = baseRow(opts.label || name, { align: 'left' })
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value ?? ''
  commitOnEnter(input)
  mountField(handle, input)
  const widget = new DOMWidget(name, 'dom-text', value ?? '', handle.row, { height: 26 })
  input.addEventListener('input', () => {
    widget.value = input.value
  })
  widget.syncDom = () => { input.value = widget.value == null ? '' : String(widget.value) }
  const setDisabled = (d: boolean) => {
    input.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/** 下拉控件（COMBO）；◀ ▶ 循环切换选项 */
export function createComboWidget(
  name: string,
  value: string,
  options: string[],
  opts: { label?: string } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const handle = baseRow(opts.label || name, { steppable: true })
  const select = document.createElement('select')
  select.className = 'lg-select'
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt
    o.textContent = opt
    select.appendChild(o)
  }
  select.value = value ?? options[0] ?? ''

  const cycle = (dir: -1 | 1) => {
    const list = [...select.options]
    if (!list.length) return
    const i = Math.max(0, list.findIndex((o) => o.value === select.value))
    const nextIdx = (i + dir + list.length) % list.length
    select.value = list[nextIdx].value
    widget.value = select.value
    select.dispatchEvent(new Event('change'))
  }
  const widget = new DOMWidget(name, 'dom-combo', select.value, handle.row, { height: 26 })
  mountField(handle, select, cycle)
  select.addEventListener('change', () => {
    widget.value = select.value
  })
  widget.syncDom = () => {
    const v = String(widget.value ?? '')
    if (v && ![...select.options].some((o) => o.value === v)) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v
      select.appendChild(o)
    }
    select.value = v
  }
  const setDisabled = (d: boolean) => {
    select.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/**
 * 下拉 + 上传按钮（LoadImage 类节点）
 * 行内是「下拉 + 小图标按钮」，下方可选缩略图由 createImageThumbWidget 单独挂。
 */
export function createComboUploadWidget(
  name: string,
  value: string,
  options: string[],
  opts: { label?: string; onChange?: (v: string) => void } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void; setValue: (v: string) => void } {
  const handle = baseRow(opts.label || name, { steppable: true })
  const select = document.createElement('select')
  select.className = 'lg-select'
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt
    o.textContent = opt
    select.appendChild(o)
  }
  select.value = normalizeImageValue(value) || options[0] || ''

  const uploadBtn = document.createElement('button')
  uploadBtn.className = 'lg-inline-btn'
  uploadBtn.type = 'button'
  uploadBtn.innerHTML = svgIcon('upload', 12)
  uploadBtn.title = '选择图片上传'

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.style.display = 'none'

  const widget = new DOMWidget(name, 'dom-combo-upload', select.value, handle.row, { height: 26 })

  const apply = (raw: string) => {
    const v = normalizeImageValue(raw)
    widget.value = v
    if (v && ![...select.options].some((o) => o.value === v)) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v
      select.appendChild(o)
    }
    select.value = v
  }
  const cycle = (dir: -1 | 1) => {
    const list = [...select.options]
    if (!list.length) return
    const i = Math.max(0, list.findIndex((o) => o.value === select.value))
    const nextIdx = (i + dir + list.length) % list.length
    apply(list[nextIdx].value)
    opts.onChange?.(select.value)
  }
  mountField(handle, select, cycle)
  handle.slot.appendChild(uploadBtn)
  handle.slot.appendChild(fileInput)

  select.addEventListener('change', () => {
    widget.value = select.value
    opts.onChange?.(select.value)
  })
  widget.syncDom = () => {
    apply(String(widget.value ?? ''))
    opts.onChange?.(normalizeImageValue(widget.value))
  }
  uploadBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    uploadBtn.innerHTML = svgIcon('refresh', 12)
    uploadBtn.classList.add('spin')
    try {
      const serverName = await uploadImageFile(file)
      apply(serverName)
      opts.onChange?.(serverName)
    } catch {
      uploadBtn.innerHTML = svgIcon('x', 12)
      setTimeout(() => { uploadBtn.innerHTML = svgIcon('upload', 12) }, 1500)
    } finally {
      uploadBtn.classList.remove('spin')
      if (uploadBtn.innerHTML !== svgIcon('x', 12)) uploadBtn.innerHTML = svgIcon('upload', 12)
    }
  })
  const setDisabled = (d: boolean) => {
    select.disabled = d
    uploadBtn.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled, setValue: apply }
}

/** 开关控件（BOOLEAN）；◀ ▶ 也能切 */
export function createToggleWidget(
  name: string,
  value: boolean,
  opts: { label?: string } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const handle = baseRow(opts.label || name, { steppable: true })
  const toggle = document.createElement('div')
  toggle.className = 'lg-toggle' + (value ? ' on' : '')
  mountField(handle, toggle, () => {
    widget.value = !(widget.value as boolean)
    toggle.classList.toggle('on', widget.value as boolean)
  })
  const widget = new DOMWidget(name, 'dom-toggle', !!value, handle.row, { height: 26 })
  toggle.addEventListener('click', () => {
    widget.value = !(widget.value as boolean)
    toggle.classList.toggle('on', widget.value as boolean)
  })
  widget.syncDom = () => toggle.classList.toggle('on', !!widget.value)
  const setDisabled = (d: boolean) => {
    handle.row.classList.toggle('is-linked', d)
    handle.row.style.pointerEvents = d ? 'none' : 'auto'
  }
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/** 颜色控件（COLOR） */
export function createColorWidget(
  name: string,
  value: string | number,
  opts: { label?: string; asInt?: boolean } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const asInt = !!opts.asInt
  const intToHex = (v: unknown): string => {
    if (typeof v === 'string' && v.startsWith('#')) return v
    const n = Number(v)
    return Number.isFinite(n) ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#000000'
  }
  const hexToInt = (hex: string): number => parseInt(hex.replace('#', ''), 16) || 0
  const initialHex = asInt ? intToHex(value) : typeof value === 'string' ? value : '#000000'

  const handle = baseRow(opts.label || name)
  const input = document.createElement('input')
  input.type = 'color'
  input.className = 'lg-color'
  input.value = initialHex || '#000000'
  const hexText = document.createElement('span')
  hexText.className = 'lg-hex'
  hexText.textContent = input.value.toUpperCase()
  mountField(handle, input)
  handle.slot.appendChild(hexText)

  const widget = new DOMWidget(name, 'dom-color', asInt ? hexToInt(initialHex) : input.value, handle.row, { height: 26 })
  input.addEventListener('input', () => {
    widget.value = asInt ? hexToInt(input.value) : input.value
    hexText.textContent = input.value.toUpperCase()
  })
  widget.syncDom = () => {
    input.value = asInt ? intToHex(widget.value) : String(widget.value || '#000000')
    hexText.textContent = input.value.toUpperCase()
  }
  const setDisabled = (d: boolean) => markDisabled(handle.row, d)
  stopPropagation(handle.row)
  return { widget, setDisabled }
}

/** 图片上传控件（IMAGEUPLOAD） */
export function createUploadWidget(
  name: string,
  value: unknown,
  opts: { label?: string; onUpload?: (filename: string) => void } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void; setValue: (v: { filename: string } | null) => void } {
  const handle = baseRow(opts.label || name)
  const btn = document.createElement('button')
  btn.className = 'lg-upload-btn'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.style.display = 'none'
  mountField(handle, btn)
  handle.slot.appendChild(fileInput)
  const widget = new DOMWidget(name, 'dom-upload', value ?? null, handle.row, { height: 26 })

  const refresh = () => {
    const v = widget.value as { filename?: string } | null
    btn.innerHTML = v?.filename
      ? `${svgIcon('image', 12)}<span class="lg-btn-text">${v.filename}</span>`
      : `${svgIcon('upload', 12)}<span class="lg-btn-text">${opts.label || '选择图像'}</span>`
  }
  const apply = (v: { filename: string } | null) => {
    widget.value = v
    refresh()
  }
  widget.syncDom = refresh
  refresh()
  btn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      const serverName = await uploadImageFile(file)
      apply({ filename: serverName, subfolder: '', type: 'input' } as { filename: string })
      opts.onUpload?.(serverName)
    } catch {
      btn.textContent = '上传失败'
    }
  })
  const setDisabled = (d: boolean) => {
    btn.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(handle.row)
  return { widget, setDisabled, setValue: apply }
}

/**
 * Seed 控件：ComfyUI 1.x 是「种子」数字行 + 「生成后控制」下拉行两行，
 * 这里照做（比原来挤在一行里的三个小按钮清楚得多）。
 */
export function createSeedWidget(
  name: string,
  value: number,
  opts: { min?: number; max?: number; label?: string }
): { widget: DOMWidget; setDisabled: (d: boolean) => void } {
  const wrap = document.createElement('div')
  wrap.className = 'lg-dom-widget lg-stack'

  const numRow = baseRow(opts.label || name, { steppable: true })
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  if (opts.min !== undefined) input.min = String(opts.min)
  if (opts.max !== undefined) input.max = String(opts.max)
  commitOnEnter(input)

  const apply = (v: number) => {
    widget.value = Math.max(opts.min ?? 0, v)
    input.value = String(widget.value)
  }
  const widget = new DOMWidget(name, 'dom-seed', value, wrap, { height: 56 })
  mountField(numRow, input, (dir) => apply(Number(widget.value ?? 0) + dir))
  input.addEventListener('input', () => {
    const v = Number(input.value)
    if (!Number.isNaN(v)) widget.value = v
  })
  widget.syncDom = () => { input.value = String(widget.value ?? 0) }
  numRow.row.style.gridColumn = '1 / -1'

  // 第二行：生成后控制（fixed / increment / randomize）
  const ctrlRow = baseRow('生成后控制', { steppable: true })
  const select = document.createElement('select')
  select.className = 'lg-select'
  const MODES: Array<{ v: string; t: string; icon?: string }> = [
    { v: 'fixed', t: 'fixed', icon: 'lock' },
    { v: 'increment', t: 'increment', icon: 'plus' },
    { v: 'randomize', t: 'randomize', icon: 'shuffle' }
  ]
  for (const m of MODES) {
    const o = document.createElement('option')
    o.value = m.v
    o.textContent = m.t
    select.appendChild(o)
  }
  select.value = 'fixed'
  const setMode = (m: string) => {
    select.value = m
    ;(widget as unknown as { seedMode: string }).seedMode = m
  }
  mountField(ctrlRow, select, (dir) => {
    const i = MODES.findIndex((m) => m.v === select.value)
    setMode(MODES[(i + dir + MODES.length) % MODES.length].v)
  })
  select.addEventListener('change', () => setMode(select.value))
  ;(widget as unknown as { seedMode: string }).seedMode = 'fixed'
  // ComfyUI 兼容：序列化成 [种子, 生成后控制] 两槽（否则外部工作流载入后参数整体错位）
  widget.valueSlots = 2
  widget.getExtraValues = () => [(widget as unknown as { seedMode?: string }).seedMode || 'fixed']
  widget.setExtraValues = (vals) => {
    const m = String(vals[0] ?? 'fixed')
    if (MODES.some((x) => x.v === m)) setMode(m)
  }

  wrap.append(numRow.row, ctrlRow.row)
  stopPropagation(wrap)
  const setDisabled = (d: boolean) => {
    input.disabled = d
    select.disabled = d
    markDisabled(numRow.row, d)
    markDisabled(ctrlRow.row, d)
  }
  return { widget, setDisabled }
}

/** 图片预览控件（PreviewImage 输出显示） */
export function createImagePreviewWidget(name: string): { widget: DOMWidget; setValue: (ref: unknown) => void } {
  const row = document.createElement('div')
  row.className = 'lg-dom-widget lg-image-widget'
  const img = document.createElement('img')
  img.style.display = 'none'
  img.title = '点击在新窗口查看原图'
  const ph = document.createElement('div')
  ph.className = 'ph'
  ph.textContent = '执行后显示图像'
  const meta = document.createElement('div')
  meta.className = 'img-meta'
  row.append(ph, img, meta)
  const widget = new DOMWidget(name, 'dom-image', null, row, { height: 240, flexible: true, minHeight: 160 })
  const apply = (ref: unknown) => {
    const r = ref as { filename?: string; subfolder?: string; type?: string; source?: string; width?: number; height?: number } | null
    if (r?.filename) {
      const q = new URLSearchParams({ filename: r.filename, subfolder: r.subfolder || '', type: r.type || 'output' })
      if (r.source) q.set('source', r.source)
      const url = `/view?${q.toString()}`
      img.src = url
      img.style.display = 'block'
      ph.style.display = 'none'
      meta.textContent = r.width && r.height ? `${r.width}×${r.height} · ${r.filename}` : r.filename
      img.onclick = () => window.open(url, '_blank')
      img.onload = () => row.dispatchEvent(new CustomEvent('lg-resize', { bubbles: true }))
      widget.value = r
    } else {
      img.style.display = 'none'
      ph.style.display = 'block'
      meta.textContent = ''
    }
  }
  apply(null)
  stopPropagation(row)
  return { widget, setValue: apply }
}

/** 输入图像的缩略图（LoadImage 节点） */
export function createImageThumbWidget(name: string): { widget: DOMWidget; setValue: (filename: string) => void } {
  const row = document.createElement('div')
  row.className = 'lg-dom-widget lg-image-widget'
  const img = document.createElement('img')
  img.style.display = 'none'
  img.title = '点击在新窗口查看原图'
  const ph = document.createElement('div')
  ph.className = 'ph'
  ph.textContent = '未选择图像'
  row.append(ph, img)
  const widget = new DOMWidget(name, 'dom-thumb', '', row, { height: 200, flexible: true, minHeight: 150 })
  const apply = (raw: string) => {
    const filename = normalizeImageValue(raw)
    if (filename) {
      const q = new URLSearchParams({ filename, subfolder: '', type: 'input' })
      const url = `/view?${q.toString()}`
      img.src = url
      img.style.display = 'block'
      ph.style.display = 'none'
      img.onclick = () => window.open(url, '_blank')
      img.onload = () => row.dispatchEvent(new CustomEvent('lg-resize', { bubbles: true }))
      img.onerror = () => {
        img.style.display = 'none'
        ph.style.display = 'block'
        ph.textContent = `找不到图片：${filename}`
      }
    } else {
      img.style.display = 'none'
      ph.style.display = 'block'
      ph.textContent = '未选择图像'
    }
    widget.value = filename
  }
  stopPropagation(row)
  return { widget, setValue: apply }
}

/** 文本显示控件（TextDisplay / 数值显示 输出显示） */
export function createTextDisplayWidget(name: string): { widget: DOMWidget; setValue: (text: unknown) => void } {
  const row = document.createElement('div')
  row.className = 'lg-dom-widget lg-text-widget'
  const box = document.createElement('div')
  box.className = 'lg-text-display'
  box.textContent = '执行后显示内容'
  row.appendChild(box)
  const widget = new DOMWidget(name, 'dom-text-display', '', row, { height: 96 })
  const apply = (text: unknown) => {
    const t = text == null ? '' : String(text)
    box.textContent = t || '（无内容）'
    box.title = t
    widget.value = t
  }
  widget.syncDom = () => apply(widget.value)
  stopPropagation(row)
  return { widget, setValue: apply }
}

/** 聊天控件（ChatNode） */
export function createChatWidget(name: string): {
  widget: DOMWidget
  setHistory: (msgs: Array<{ role: string; content: string }>) => void
  onSend: (cb: (message: string) => void) => void
} {
  const row = document.createElement('div')
  row.className = 'lg-dom-widget lg-chat'
  const msgs = document.createElement('div')
  msgs.className = 'msgs'
  const inputRow = document.createElement('div')
  inputRow.className = 'input-row'
  const textarea = document.createElement('textarea')
  textarea.placeholder = '输入消息…'
  const sendBtn = document.createElement('button')
  sendBtn.className = 'send-btn'
  sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>'
  sendBtn.title = '发送'
  inputRow.append(textarea, sendBtn)
  row.append(msgs, inputRow)
  const widget = new DOMWidget(name, 'dom-chat', [], row, { height: 240 })
  let sendCb: ((m: string) => void) | null = null
  const doSend = () => {
    const text = textarea.value.trim()
    if (!text || !sendCb) return
    sendCb(text)
    textarea.value = ''
  }
  sendBtn.addEventListener('click', doSend)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  })
  const setHistory = (list: Array<{ role: string; content: string }>) => {
    msgs.innerHTML = ''
    for (const m of list) {
      const div = document.createElement('div')
      div.className = `msg ${m.role}`
      div.textContent = m.content
      msgs.appendChild(div)
    }
    msgs.scrollTop = msgs.scrollHeight
    widget.value = list
  }
  stopPropagation(row)
  return { widget, setHistory, onSend: (cb) => { sendCb = cb } }
}

// ==================== API 服务商控件 ====================

export interface ProviderInfo {
  id: string
  name: string
  provider_type?: string
  default_model?: string
  base_url?: string
  enabled?: boolean | number
}

let providerList: ProviderInfo[] = []
const providerRefreshers = new Set<() => void>()

export function setProviderList(list: ProviderInfo[]): void {
  providerList = Array.isArray(list) ? list : []
  for (const fn of providerRefreshers) fn()
}

export function getProviderList(): ProviderInfo[] {
  return providerList
}

export function createProviderWidget(
  name: string,
  value: string,
  opts: { label?: string; onRefresh?: () => void } = {}
): { widget: DOMWidget; setDisabled: (d: boolean) => void; setValue: (v: string) => void } {
  const wrap = document.createElement('div')
  wrap.className = 'lg-dom-widget lg-stack'

  const handle = baseRow(opts.label || '服务商', { steppable: true })
  const select = document.createElement('select')
  select.className = 'lg-select'
  const refreshBtn = document.createElement('button')
  refreshBtn.className = 'lg-inline-btn'
  refreshBtn.type = 'button'
  refreshBtn.innerHTML = svgIcon('refresh', 12)
  refreshBtn.title = '重新读取设置里的 API 服务商'

  const info = document.createElement('div')
  info.className = 'provider-info'

  mountField(handle, select, (dir) => {
    const list = [...select.options]
    if (!list.length) return
    const i = Math.max(0, list.findIndex((o) => o.value === select.value))
    select.value = list[(i + dir + list.length) % list.length].value
    widget.value = select.value
    paint()
  })
  handle.slot.appendChild(refreshBtn)
  wrap.append(handle.row, info)

  const widget = new DOMWidget(name, 'dom-provider', value ?? '', wrap, { height: 48 })

  const paint = () => {
    const cur = String(widget.value ?? '')
    select.innerHTML = ''
    if (!providerList.length) {
      const o = document.createElement('option')
      o.value = ''
      o.textContent = '（未配置服务商）'
      select.appendChild(o)
      select.value = ''
      info.className = 'provider-info warn'
      info.textContent = '请到「设置 → API 服务商」添加并启用一个服务商'
      return
    }
    for (const p of providerList) {
      const o = document.createElement('option')
      o.value = p.id
      o.textContent = p.enabled ? p.name : `${p.name}（已停用）`
      select.appendChild(o)
    }
    let resolved = cur
    if (cur && !providerList.some((p) => p.id === cur)) {
      const byName = providerList.find((p) => p.name === cur)
      if (byName) {
        resolved = byName.id
        widget.value = resolved
      }
    }
    if (!resolved) resolved = providerList[0].id
    select.value = resolved
    if (select.value !== resolved) {
      const o = document.createElement('option')
      o.value = resolved
      o.textContent = `（已失效）${cur}`
      select.appendChild(o)
      select.value = resolved
    }
    const p = providerList.find((x) => x.id === select.value)
    if (!p) {
      info.className = 'provider-info warn'
      info.textContent = '该服务商配置已不存在，请重新选择'
      return
    }
    const on = !!p.enabled
    info.className = 'provider-info' + (on ? '' : ' warn')
    const parts = [on ? '已启用' : '已停用', p.provider_type || '未知类型', p.default_model || '未设默认模型']
    info.textContent = `${on ? '●' : '○'} ${parts.join(' · ')}`
    if (p.base_url) info.title = p.base_url
  }

  select.addEventListener('change', () => {
    widget.value = select.value
    paint()
  })
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spin')
    opts.onRefresh?.()
    window.setTimeout(() => refreshBtn.classList.remove('spin'), 600)
  })

  providerRefreshers.add(paint)
  widget.syncDom = paint
  paint()

  const setDisabled = (d: boolean) => {
    select.disabled = d
    refreshBtn.disabled = d
    markDisabled(handle.row, d)
  }
  stopPropagation(wrap)
  return { widget, setDisabled, setValue: (v: string) => { widget.value = v; paint() } }
}

/** 把控件挂到节点上 */
export function attachWidget(node: LGraphNode, widget: DOMWidget, setDisabled?: (d: boolean) => void): void {
  node.widgets = node.widgets || []
  node.widgets.push(widget)
  if (setDisabled) {
    ;(widget as unknown as { setDisabled: (d: boolean) => void }).setDisabled = setDisabled
  }
}
