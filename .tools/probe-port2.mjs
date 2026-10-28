import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9360 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'p2' + crypto.randomBytes(4).toString('hex'))
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
const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
await sleep(2000)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale=1; c.ds.offset[0]=0; c.ds.offset[1]=0; c.setDirty(true,true); return 1 })()`)
await sleep(600)
console.log(await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(5);
  return n.widgets.map((w,i) => {
    const el = w.element; if (!el) return { i, el: 'null' };
    const port = el.querySelector('.lg-port');
    const er = el.getBoundingClientRect(); const pr = port ? port.getBoundingClientRect() : null;
    return { i, name: w.name, cls: el.className, connected: el.isConnected, dataset: {...el.dataset},
      parent: el.parentElement && el.parentElement.className,
      rect: [Math.round(er.x), Math.round(er.y), Math.round(er.width), Math.round(er.height)],
      port: port ? { disp: getComputedStyle(port).display, rect: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)], parentNode: port.parentElement.className } : 'none' };
  });
})())`))
ws.close(); edge.kill()
