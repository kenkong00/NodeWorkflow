/**
 * 输出名与组件行的「屏幕像素间隔」验收（多缩放档位 + 放大截图）。
 * gap = 输出名左缘 - 组件行右缘，必须 > 0 且看起来有呼吸（≥ 6px @ scale≥0.75）。
 */
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9920 + Math.floor(Math.random() * 15)
const profile = path.join(os.tmpdir(), 'pg' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description) : r.result.value }

const wf = JSON.parse(fs.readFileSync('public/examples/03-图像预览.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(1600)
// 复刻用户截图：长文件名
await ev(`(() => {
  const g = window.__comfyGraph
  const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
  const w = (n.widgets || []).find(x => x.type === 'dom-select' || (x.options && x.options.values))
  if (w) w.value = 'ComfyUI_00161_png'
  for (const x of n.widgets || []) x.syncDom && x.syncDom()
  n.setSize([420, n.size[1]]); g.refitNodeHeight(n)
  g.canvas.setDirty(true, true); return 1
})()`)
await sleep(800)

let pass = 0, fail = 0
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`) }

console.log('\n=== 各缩放档位的间隔（屏幕像素） ===')
const scales = [0.5, 0.75, 1, 1.25, 1.5]
let worstAt1 = 999
for (const s of scales) {
  await ev(`(() => {
    const g = window.__comfyGraph, c = g.canvas
    const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
    c.ds.scale = ${s}
    c.ds.offset[0] = -n.pos[0] + 60
    c.ds.offset[1] = -n.pos[1] + 80
    c.setDirty(true, true); return 1
  })()`)
  await sleep(500)
  const r = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph, c = g.canvas
    const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
    const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale, o = c.ds.offset
    c.ctx.save(); c.ctx.font = c.inner_text_font
    let tw = 0, name = ''
    for (const sl of n.outputs || []) {
      const t = String(sl.label != null ? sl.label : sl.name || '')
      const w = t ? c.ctx.measureText(t).width : 0
      if (w > tw) { tw = w; name = t }
    }
    c.ctx.restore()
    const textLeftPx = cr.left + (n.getConnectionPos(false, 0)[0] - 10 - tw + o[0]) * s
    let rowRightPx = 0, rowW = 0
    for (const w of n.widgets || []) {
      const el = w.element
      if (!el) continue
      const b = el.getBoundingClientRect()
      if (!b.width) continue
      rowRightPx = Math.max(rowRightPx, b.right); rowW = Math.max(rowW, b.width)
    }
    return { scale: s, name, textLeftPx: Math.round(textLeftPx * 10) / 10, rowRightPx: Math.round(rowRightPx * 10) / 10, gapPx: Math.round((textLeftPx - rowRightPx) * 10) / 10, rowW: Math.round(rowW) }
  })())`))
  console.log(`    scale=${r.scale}  输出名「${r.name}」 行右缘=${r.rowRightPx} 文字左缘=${r.textLeftPx} → 间隔=${r.gapPx}px`)
  if (r.rowRightPx === 0) {
    // scale ≤ 0.5 时组件层整体隐藏（show = scale > 0.5），不参与布局，没有压字问题
    check(`scale=${s} 组件层已隐藏（小缩放不渲染 DOM 控件）`, r.gapPx > 0, 'row hidden')
  } else if (s >= 0.75) {
    check(`scale=${s} 有可见间隔（≥6px）`, r.gapPx >= 6, `gap=${r.gapPx}`)
  } else {
    check(`scale=${s} 不压字（>0px）`, r.gapPx > 0, `gap=${r.gapPx}`)
  }
  if (s === 1) worstAt1 = r.gapPx
}

// 放大截图（1:1 + DPR2，再 clip scale 4）
await ev(`(() => {
  const g = window.__comfyGraph, c = g.canvas
  const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
  c.ds.scale = 1
  c.ds.offset[0] = -n.pos[0] + 60
  c.ds.offset[1] = -n.pos[1] + 80
  c.setDirty(true, true); return 1
})()`)
await sleep(600)
const geo = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas
  const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
  const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale, o = c.ds.offset
  return { right: cr.left + (n.pos[0] + n.size[0] + o[0]) * s, top: cr.top + (n.pos[1] + o[1]) * s, h: 70 }
})())`))
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: geo.right - 150, y: geo.top + 10, width: 160, height: 70, scale: 4 }, captureBeyondViewport: true })
fs.mkdirSync('.shots', { recursive: true })
fs.writeFileSync('.shots/98-outgap-zoom.png', Buffer.from(shot.data, 'base64'))
console.log('\n已保存放大截图 .shots/98-outgap-zoom.png')

const errs = await ev(`JSON.stringify((window.__logs || []).filter(l => /error/i.test(String(l.level || l.type || ''))))`)
console.log('控制台 error:', errs)
console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
ws.close(); edge.kill()
