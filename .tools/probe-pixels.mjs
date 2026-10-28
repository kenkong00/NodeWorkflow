/**
 * 像素级验收（唯一可信口径：直接读画布像素，不靠字体度量公式）。
 * 对多种节点类型量：组件行 DOM 右缘 ↔ 输出名最左像素 的真实间距。
 */
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9980 + Math.floor(Math.random() * 9)
const profile = path.join(os.tmpdir(), 'px' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1500,900', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description) : r.result.value }
let pass = 0, fail = 0
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`) }

const TYPES = ['LoadImage', 'CLIPTextEncode', 'KSampler', 'ImageScale', 'PrimitiveInt', 'CheckpointLoaderSimple', 'VAEEncode', 'ControlNetApplyAdvanced']
console.log('\n=== 像素级实测：组件行右缘 ↔ 输出名最左像素（scale=1, dpr=1） ===')
const results = []
for (const type of TYPES) {
  const r = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph, c = g.canvas, ctx = c.ctx
    g.graph.clear()
    const n = g.addNode(${JSON.stringify(type)}, [60, 60])
    if (!n) return { type: ${JSON.stringify(type)}, err: 'addNode 返回 null' }
    n.setSize([430, 240]); g.refitNodeHeight(n)
    c.ds.scale = 1; c.ds.offset[0] = 0; c.ds.offset[1] = 0; c.setDirty(true, true)
    return { type: ${JSON.stringify(type)}, ready: true, id: n.id }
  })())`))
  if (!r.ready) { check(`${type} 可构造`, false, JSON.stringify(r)); continue }
  await sleep(700)
  const m = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph, c = g.canvas, ctx = c.ctx
    const n = g.graph.getNodeById(${r.id})
    const cr = c.canvas.getBoundingClientRect()
    const dpr = c.canvas.width / cr.width, s = c.ds.scale, o = c.ds.offset
    let rowRight = 0
    for (const w of n.widgets || []) { const el = w.element; if (!el) continue; const b = el.getBoundingClientRect(); if (b.width) rowRight = Math.max(rowRight, b.right) }
    if (!rowRight) return { err: '组件行未渲染' }
    const pos = n.getConnectionPos(false, 0)
    const slotY = cr.top + (pos[1] + o[1]) * s
    const nodeRight = cr.left + (n.pos[0] + n.size[0] + o[0]) * s
    const y0 = Math.round((slotY - cr.top - 5) * dpr), y1 = Math.round((slotY - cr.top + 6) * dpr)
    const x0 = Math.round((rowRight - cr.left - 2) * dpr)
    const x1 = Math.round((nodeRight - cr.left - 18) * dpr)   // 排除端口圆点
    const wpx = Math.max(1, x1 - x0)
    const img = ctx.getImageData(x0, y0, wpx, Math.max(1, y1 - y0)).data
    let first = null, last = null
    for (let x = 0; x < wpx; x++) {
      let bright = false
      for (let y = 0; y < (y1 - y0); y++) {
        const i = (y * wpx + x) * 4
        const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]
        if (lum > 90) { bright = true; break }
      }
      if (bright) { if (first == null) first = x; last = x }
    }
    const name = String(n.outputs[0].label != null ? n.outputs[0].label : n.outputs[0].name)
    return first == null
      ? { label: name, gapPx: null, note: '该行未找到文字像素' }
      : { label: name, gapPx: Math.round((first / dpr - 2) * 10) / 10, textW: Math.round(((last - first + 1) / dpr) * 10) / 10, rowToNodeRight: Math.round((nodeRight - rowRight) * 10) / 10 }
  })())`))
  results.push({ type, ...m })
  if (m.err === '组件行未渲染') {
    // 该节点没有 widget（只有端口），不涉及「组件压输出名」，跳过
    console.log(`  SKIP  ${type} 没有组件行（纯端口节点）`)
    continue
  }
  const ok = m.gapPx != null && m.gapPx >= 8
  check(`${type} 输出名「${m.label}」与组件行间隔 ≥8px`, ok, JSON.stringify(m))
}
console.log('\n汇总：', JSON.stringify(results.map((r) => ({ t: r.type, label: r.label, gap: r.gapPx }))))

// 5x 放大截图（LoadImage）
await ev(`(() => {
  const g = window.__comfyGraph; g.graph.clear()
  const n = g.addNode('LoadImage', [60, 60]); n.setSize([430, 200]); g.refitNodeHeight(n)
  const c = g.canvas; c.ds.scale = 1; c.ds.offset[0] = 0; c.ds.offset[1] = 0; c.setDirty(true, true); return 1
})()`)
await sleep(900)
const geo = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas
  const n = Object.values(g.graph._nodes)[0]
  const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale, o = c.ds.offset
  let rowRight = 0
  for (const w of n.widgets || []) { const el = w.element; if (!el) continue; const b = el.getBoundingClientRect(); if (b.width) rowRight = Math.max(rowRight, b.right) }
  const pos = n.getConnectionPos(false, 0)
  return { rowRight, slotY: cr.top + (pos[1] + o[1]) * s, nodeRight: cr.left + (n.pos[0] + n.size[0] + o[0]) * s }
})())`))
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(geo.rowRight - 40), y: Math.round(geo.slotY - 18), width: Math.round(geo.nodeRight - geo.rowRight + 50), height: 40, scale: 5 }, captureBeyondViewport: true })
fs.mkdirSync('.shots', { recursive: true })
fs.writeFileSync('.shots/98-pixel-gap.png', Buffer.from(shot.data, 'base64'))
console.log('\n已保存 5x 放大截图 .shots/98-pixel-gap.png')
console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
ws.close(); edge.kill()
