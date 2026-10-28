import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9800 + Math.floor(Math.random() * 20)
const profile = path.join(os.tmpdir(), 'pr' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
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
const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
console.log('has onConfigure on proto:', await ev(`typeof window.__comfyGraph.graph.getNodeById(5).onConfigure`))
console.log('ctor name:', await ev(`window.__comfyGraph.graph.getNodeById(5).constructor.name`))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(1500)
console.log('after load:', await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(5).inputs.map(s=>({n:s.name,w:!!s.widget,l:s.label})))`))
console.log('widget names:', await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(5).widgets.map(w=>({n:w.name,v:w.value})))`))
console.log('widgets_values:', await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(5).widgets_values)`))
ws.close(); edge.kill()
