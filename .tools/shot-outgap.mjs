/** 生成一张"用户视角"的节点截图（长文件名 + 输出名），用于人工核对间隔 */
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9950 + Math.floor(Math.random() * 9)
const profile = path.join(os.tmpdir(), 'sh' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description) : r.result.value }
const wf = JSON.parse(fs.readFileSync('public/examples/03-图像预览.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(1600)
await ev(`(() => {
  const g = window.__comfyGraph
  const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
  for (const w of n.widgets || []) { if (w.syncDom && String(w.value || '').length > 0 && /dom-select/.test(w.type)) w.value = 'ComfyUI_00161_png'; w.syncDom && w.syncDom() }
  n.setSize([430, n.size[1]]); g.refitNodeHeight(n)
  const c = g.canvas; c.ds.scale = 1.15
  c.ds.offset[0] = -n.pos[0] + 40; c.ds.offset[1] = -n.pos[1] + 40
  c.setDirty(true, true); return 1
})()`)
await sleep(900)
const geo = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas
  const n = Object.values(g.graph._nodes).find(x => /LoadImage/.test(x.type))
  const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale, o = c.ds.offset
  return { x: cr.left + (n.pos[0] + o[0]) * s, y: cr.top + (n.pos[1] + o[1]) * s, w: n.size[0] * s, h: n.size[1] * s }
})())`))
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: geo.x - 10, y: geo.y - 10, width: geo.w + 190, height: geo.h + 30, scale: 2 }, captureBeyondViewport: true })
fs.mkdirSync('.shots', { recursive: true })
fs.writeFileSync('.shots/99-outgap-node.png', Buffer.from(shot.data, 'base64'))
console.log('saved .shots/99-outgap-node.png', JSON.stringify(geo))
ws.close(); edge.kill()
