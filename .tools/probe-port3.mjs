import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9440 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'p3' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-first-run',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1680,1000','about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find(t => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description) : r.result.value }
const mouse = async (t, x, y, btn='left', buttons=1) => { await send('Input.dispatchMouseEvent', { type: t, x, y, button: btn, buttons, clickCount: (t==='mousePressed'||t==='mouseReleased')?1:0 }); await sleep(45) }
const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(1800)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale=1; c.ds.offset[0]=0; c.ds.offset[1]=0; c.setDirty(true,true); return 1 })()`)
await sleep(500)
// 解绑 a
console.log('unlink:', await ev(`(() => { const g=window.__comfyGraph.graph, n=g.getNodeById(5); const id=n.inputs[1].link; if(id!=null) g.removeLink(id); return 'removed '+id })()`))
await sleep(600)
const pt = JSON.parse(await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(5); const el = n.widgets[1].element;
  const port = el.querySelector('.lg-port'); const r = port.getBoundingClientRect();
  return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), w: Math.round(r.width),
           linked: el.dataset.linked, disp: getComputedStyle(port).display, pe: getComputedStyle(port).pointerEvents };
})())`))
console.log('port=', JSON.stringify(pt))
await mouse('mouseMoved', pt.x, pt.y, 'none', 0)
await sleep(250)
console.log('elemAtPoint=', await ev(`(() => { const e = document.elementFromPoint(${pt.x}, ${pt.y}); return e ? (e.className || e.tagName) : 'none' })()`))
// 标记我们的 handler 是否触发
await ev(`(() => { window.__hit = 0; const layer = document.querySelector('.canvas-host')?.parentElement; window.addEventListener('pointerdown', () => { window.__hit++ }, true); return 1 })()`)
await mouse('mousePressed', pt.x, pt.y)
await sleep(300)
console.log('hit=', await ev(`window.__hit`), 'connecting=', await ev(`(() => { const c=window.__comfyGraph.canvas; return JSON.stringify({n:!!c.connecting_node,i:!!c.connecting_input,o:!!c.connecting_output}) })()`))
ws.close(); edge.kill()
