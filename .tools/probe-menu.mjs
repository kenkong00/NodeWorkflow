import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9400 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'pm' + crypto.randomBytes(4).toString('hex'))
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
const mouse = async (t, x, y, btn='left', buttons=1, mods=0) => { await send('Input.dispatchMouseEvent', { type: t, x, y, button: btn, buttons, clickCount: (t==='mousePressed'||t==='mouseReleased')?1:0, modifiers: mods }); await sleep(45) }
const click = async (x,y,mods=0) => { await mouse('mouseMoved',x,y,'none',0,mods); await mouse('mousePressed',x,y,'left',1,mods); await mouse('mouseReleased',x,y,'left',0,mods); await sleep(120) }
const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(1800)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale=1; c.ds.offset[0]=0; c.ds.offset[1]=0; c.setDirty(true,true); return 1 })()`)
await sleep(500)
const nr = async (id) => JSON.parse(await ev(`JSON.stringify((() => { const n = window.__comfyGraph.graph.getNodeById(${id}); const c = window.__comfyGraph.canvas; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left+n.pos[0]), y: Math.round(r.top+n.pos[1]), w: n.size[0], h: n.size[1] } })())`))
const n1 = await nr(3), n2 = await nr(4)
await click(n1.x+60, n1.y+46)
await click(n2.x+60, n2.y+46, 2)
console.log('sel=', await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).join(',')`))
// rclick 直接
const rx = n1.x+220, ry = n1.y+40
await mouse('mouseMoved', rx, ry, 'none', 0)
await send('Input.dispatchMouseEvent', { type:'mousePressed', x:rx, y:ry, button:'right', buttons:2, clickCount:1 })
await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:rx, y:ry, button:'right', buttons:0, clickCount:1 })
await sleep(400)
console.log('A real rclick menus=', await ev(`document.querySelectorAll('.ctx-menu').length`))
console.log('A sel=', await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).join(',')`))
// 合成 contextmenu
await ev(`(() => {
  const host = document.querySelector('.canvas-host') || document.querySelector('canvas').parentElement;
  const r = document.querySelector('.canvas-host') ? document.querySelector('.canvas-host').getBoundingClientRect() : { left:0, top:0 };
  host.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, clientX: ${rx}, clientY: ${ry} }));
  return 1 })()`)
await sleep(400)
console.log('B synthetic menus=', await ev(`document.querySelectorAll('.ctx-menu').length`), 'text=', await ev(`(document.querySelector('.ctx-menu')||{}).innerText`))
ws.close(); edge.kill()
