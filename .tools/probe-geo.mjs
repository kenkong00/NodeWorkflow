import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9860 + Math.floor(Math.random() * 20)
const profile = path.join(os.tmpdir(), 'pg' + crypto.randomBytes(4).toString('hex'))
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
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(2500)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1; c.ds.offset[0] = -30; c.ds.offset[1] = 10; c.setDirty(true,true); return 1 })()`)
await sleep(600)
console.log(await ev(`(() => {
  const g = window.__comfyGraph.graph, c = window.__comfyGraph.canvas
  const rows = []
  for (const n of Object.values(g._nodes)) {
    rows.push({ id: n.id, t: n.type, pos: [...n.pos], size: [...n.size], out0: [...n.getConnectionPos(false,0)], nw: n.widgets?.length })
  }
  const rect = c.canvas.getBoundingClientRect()
  return JSON.stringify({ ds: {s:c.ds.scale, o:[...c.ds.offset]}, rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height}, rows })
})()`))
ws.close(); edge.kill()
