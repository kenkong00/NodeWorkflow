import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9310 + Math.floor(Math.random() * 40)
const profile = path.join(os.tmpdir(), 'pd' + crypto.randomBytes(4).toString('hex'))
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

// 端口位置
const p = JSON.parse(await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(5); const el = n.widgets[1].element;
  const port = el.querySelector('.lg-port'); const r = port.getBoundingClientRect();
  const c = window.__comfyGraph.canvas; const cr = c.canvas.getBoundingClientRect();
  const cp = n.getConnectionPos(true, 1);
  return { port: { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) },
           connPos: [cp[0], cp[1]],
           screenConn: [Math.round(cr.left + (cp[0]+c.ds.offset[0])), Math.round(cr.top + (cp[1]+c.ds.offset[1]))],
           slotIdx: el.dataset.slot, nodeId: el.dataset.nodeId };
})())`))
console.log('port=', JSON.stringify(p))

await mouse('mouseMoved', p.port.x, p.port.y, 'none', 0)
await sleep(200)
const st0 = await ev(`(() => { const c = window.__comfyGraph.canvas; return JSON.stringify({ n:!!c.connecting_node, i:!!c.connecting_input, o:!!c.connecting_output, drag:!!c.dragging_node, sel:Object.keys(c.selected_nodes||{}).length }) })()`)
console.log('before press:', st0)
await mouse('mousePressed', p.port.x, p.port.y)
await sleep(250)
console.log('after press :', await ev(`(() => { const c = window.__comfyGraph.canvas; return JSON.stringify({ n:!!c.connecting_node, i:!!c.connecting_input, o:!!c.connecting_output, drag:!!c.dragging_node, node5pos:[...window.__comfyGraph.graph.getNodeById(5).pos] }) })()`))
await mouse('mouseMoved', p.port.x - 40, p.port.y, 'none', 0)
await sleep(150)
console.log('after move  :', await ev(`(() => { const c = window.__comfyGraph.canvas; return JSON.stringify({ n:!!c.connecting_node, i:!!c.connecting_input, o:!!c.connecting_output, drag:!!c.dragging_node, node5pos:[...window.__comfyGraph.graph.getNodeById(5).pos] }) })()`))

// 右键节点菜单
await mouse('mouseReleased', p.port.x - 40, p.port.y, 'left', 0)
await sleep(300)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.selectNodes([window.__comfyGraph.graph.getNodeById(3)]); return 1 })()`)
await sleep(200)
const nr = JSON.parse(await ev(`JSON.stringify((() => { const n = window.__comfyGraph.graph.getNodeById(3); const c = window.__comfyGraph.canvas; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left + (n.pos[0]+c.ds.offset[0]) + 140), y: Math.round(r.top + (n.pos[1]+c.ds.offset[1]) + 45) } })())`))
// 先点一个节点（多选场景）
await ev(`(() => { const g = window.__comfyGraph; g.canvas.selectNodes([g.graph.getNodeById(3), g.graph.getNodeById(4)]); return 1 })()`)
await sleep(200)
await mouse('mouseMoved', nr.x, nr.y, 'none', 0)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nr.x, y: nr.y, button: 'right', buttons: 2, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nr.x, y: nr.y, button: 'right', buttons: 0, clickCount: 1 })
await sleep(400)
console.log('menu count:', await ev(`document.querySelectorAll('.ctx-menu').length`))
console.log('menu text:', await ev(`(document.querySelector('.ctx-menu')||{}).innerText`))
console.log('sel:', await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).join(',')`))
console.log('host children:', await ev(`[...document.body.children].map(e=>e.className||e.tagName).join(' | ')`))
ws.close(); edge.kill()
