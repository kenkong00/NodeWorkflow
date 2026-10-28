import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9560 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'pl' + crypto.randomBytes(4).toString('hex'))
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
await sleep(1600)
await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale=1; c.ds.offset[0]=0; c.ds.offset[1]=0; c.setDirty(true,true); return 1 })()`)
await sleep(500)
await ev(`(() => { const g=window.__comfyGraph.graph, n=g.getNodeById(5); const id=n.inputs[1].link; if(id!=null) g.removeLink(id); return 1 })()`)
const srcId = await ev(`(() => { const n = window.__comfyGraph.addNode('PrimitiveInt', [520, 560]); return n ? n.id : null })()`)
await sleep(800)
console.log('srcId=', srcId)
const geo = JSON.parse(await ev(`JSON.stringify((() => {
  const n5 = window.__comfyGraph.graph.getNodeById(5); const el = n5.widgets[1].element;
  const port = el.querySelector('.lg-port'); const pr = port.getBoundingClientRect();
  const src = window.__comfyGraph.graph.getNodeById(${srcId}); const op = src.getConnectionPos(false, 0);
  const c = window.__comfyGraph.canvas; const cr = c.canvas.getBoundingClientRect();
  return {
    from: { x: Math.round(pr.left + pr.width/2), y: Math.round(pr.top + pr.height/2) },
    to: { x: Math.round(cr.left + (op[0]+c.ds.offset[0])), y: Math.round(cr.top + (op[1]+c.ds.offset[1])) },
    srcPos: [...src.pos], srcSize: [...src.size], op: [op[0], op[1]]
  };
})())`))
console.log('geo=', JSON.stringify(geo))
await mouse('mouseMoved', geo.from.x, geo.from.y, 'none', 0)
await sleep(220)
await mouse('mousePressed', geo.from.x, geo.from.y)
await sleep(200)
console.log('pressed=', await ev(`(() => { const c=window.__comfyGraph.canvas; return JSON.stringify({ n:!!c.connecting_node, i:!!c.connecting_input, slot:c.connecting_slot }) })()`))
for (let i = 1; i <= 12; i++) await mouse('mouseMoved', geo.from.x + (geo.to.x-geo.from.x)*i/12, geo.from.y + (geo.to.y-geo.from.y)*i/12)
await sleep(200)
console.log('direct isOverNodeOutput=', await ev(`(() => {
  const g = window.__comfyGraph; const c = g.canvas; const n = g.graph.getNodeById(${srcId});
  const p = n.getConnectionPos(false, 0);
  const slot = c.isOverNodeOutput(n, p[0], p[1]);
  const slot2 = c.isOverNodeOutput(n, c.graph_mouse[0], c.graph_mouse[1]);
  return JSON.stringify({ p: [p[0], p[1]], gm: [...c.graph_mouse], slotAtPort: slot, slotAtMouse: slot2, outType: n.outputs[0] && n.outputs[0].type, inType: g.graph.getNodeById(5).inputs[1].type, co: !!c.connecting_output, ci: !!c.connecting_input });
})()`))
console.log('moving  =', await ev(`(() => { const c=window.__comfyGraph.canvas; return JSON.stringify({ hi: c._highlight_output ? [...c._highlight_output] : null, gm: [...c.graph_mouse], over: (() => { const n = window.__comfyGraph.graph.getNodeOnPos(c.graph_mouse[0], c.graph_mouse[1], c.visible_nodes); return n && n.id })() }) })()`))
await mouse('mouseReleased', geo.to.x, geo.to.y, 'left', 0)
await sleep(400)
console.log('after   =', await ev(`(() => { const g=window.__comfyGraph.graph, n=g.getNodeById(5); const i=n.inputs.findIndex(s=>s.name==='a'); return JSON.stringify({ link: n.inputs[i].link, links: Object.keys(g.links).length }) })()`))
ws.close(); edge.kill()
