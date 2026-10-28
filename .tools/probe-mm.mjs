import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9620 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'pm2' + crypto.randomBytes(4).toString('hex'))
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
await ev(`(() => { window.__mm = 0; document.addEventListener('mousemove', () => window.__mm++, true); return 1 })()`)
// 普通移动（无按键）
await mouse('mouseMoved', 800, 400, 'none', 0)
console.log('after plain move: mm=', await ev(`window.__mm`), 'gm=', await ev(`JSON.stringify([...window.__comfyGraph.canvas.graph_mouse])`))
// 按下后移动
await mouse('mouseMoved', 700, 500, 'none', 0)
await mouse('mousePressed', 700, 500)
await sleep(150)
console.log('press: gm=', await ev(`JSON.stringify([...window.__comfyGraph.canvas.graph_mouse])`), 'block=', await ev(`window.__comfyGraph.canvas.block_click`), 'optskip=', await ev(`JSON.stringify(!!(window.__comfyGraph.canvas.options||{}).skip_events)`))
const mm0 = await ev(`window.__mm`)
await mouse('mouseMoved', 800, 520)
await sleep(150)
console.log('drag move: mm', mm0, '->', await ev(`window.__mm`), 'gm=', await ev(`JSON.stringify([...window.__comfyGraph.canvas.graph_mouse])`))
ws.close(); edge.kill()
