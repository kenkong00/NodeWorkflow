/** 新版面截图：节点/组件/组/菜单 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9700 + Math.floor(Math.random() * 40)
const profile = path.join(os.tmpdir(), 'shots2-' + crypto.randomBytes(4).toString('hex'))
const shotDir = path.resolve('.shots')
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, msgId = 0
const waiters = new Map()
const send = (m, p = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method: m, params: p }))
  return new Promise((res, rej) => {
    waiters.set(id, { resolve: res, reject: rej })
    setTimeout(() => waiters.has(id) && (waiters.delete(id), rej(new Error(m + ' timeout'))), 60000)
  })
}
let page
for (let i = 0; i < 60; i++) {
  try {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = j.find((t) => t.type === 'page')
    if (page) break
  } catch { }
  await sleep(300)
}
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiters.has(m.id)) {
    const w = waiters.get(m.id)
    waiters.delete(m.id)
    m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result)
  }
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { })
})
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value
}
const shot = async (n) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shotDir, n), Buffer.from(r.data, 'base64'))
}
const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
  await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
  await sleep(60)
}
const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y) }
const center = async (sel, idx = 0) => JSON.parse(await ev(`JSON.stringify((() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]; if(!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })())`))

const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(2400)
// 固定视图：scale=1，左上角对齐文本组，便于看清细节
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1; c.ds.offset[0] = -30; c.ds.offset[1] = 10; c.setDirty(true,true); return 1 })()`)
await sleep(600)
await shot('v2-a-nodes.png')

// 放大看单个节点
const zoom = await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1.5; c.ds.offset[0] = -40; c.ds.offset[1] = 270; c.setDirty(true,true); return c.ds.scale })()`)
await sleep(500)
await shot('v2-b-zoom.png')
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1; c.ds.offset[0] = -30; c.ds.offset[1] = 10; c.setDirty(true,true); return 1 })()`)

// 建组：选中文本链 3 个节点
const gid = await ev(`(() => {
  const g = window.__comfyGraph; const ids = [1,2,3];
  g.canvas.selectNodes(ids.map(i => g.graph.getNodeById(i)).filter(Boolean));
  return g.createGroupFromSelection('文本处理');
})()`)
await sleep(700)
await shot('v2-c-group.png')

// 右键节点（多选状态）
const nr = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = g.graph.getNodeById(1);
  const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left + (n.pos[0] + o[0]) * s + 80), y: Math.round(r.top + (n.pos[1] + o[1]) * s - 12) };
})())`))
await mouse('mouseMoved', nr.x, nr.y, 'none', 0)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nr.x, y: nr.y, button: 'right', buttons: 2, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nr.x, y: nr.y, button: 'right', buttons: 0, clickCount: 1 })
await sleep(500)
await shot('v2-d-menu.png')
await ev(`document.querySelector('.ctx-mask') && document.querySelector('.ctx-mask').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
await sleep(300)

// 组菜单
const gr = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const gp = g.groups()[0];
  const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left + (gp._pos[0] + o[0]) * s + 60), y: Math.round(r.top + (gp._pos[1] + o[1]) * s + 15) };
})())`))
await mouse('mouseMoved', gr.x, gr.y, 'none', 0)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gr.x, y: gr.y, button: 'right', buttons: 2, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gr.x, y: gr.y, button: 'right', buttons: 0, clickCount: 1 })
await sleep(500)
await shot('v2-e-groupmenu.png')

console.log('gid=', gid)
ws.close()
edge.kill()
