import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9660 + Math.floor(Math.random() * 30)
const profile = path.join(os.tmpdir(), 'pdp' + crypto.randomBytes(4).toString('hex'))
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
const mouse = async (t, x, y, btn='left', buttons=1) => { await send('Input.dispatchMouseEvent', { type: t, x, y, button: btn, buttons, clickCount: (t==='mousePressed'||t==='mouseReleased')?1:0 }); await sleep(40) }
await ev(`(() => { const g = window.__comfyGraph; g.graph.clear(); g.addNode('PrimitiveInt', [80,120]); g.addNode('ImageScale', [820,120]); g.fitView(); return 1 })()`)
await sleep(1200)
const info = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const ns = Object.values(g.graph._nodes);
  const a = ns.find(n => n.type === 'PrimitiveInt'); const b = ns.find(n => n.type === 'ImageScale');
  const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  const p = a.getConnectionPos(false, 0);
  const w = (b.widgets||[]).find(x=>x.name==='width') || (b.widgets||[])[0];
  const wr = w.element.getBoundingClientRect();
  return { a: a.id, b: b.id, src: { x: r.left+(p[0]+o[0])*s, y: r.top+(p[1]+o[1])*s },
    tgt: { x: Math.round(wr.left+6), y: Math.round(wr.top+wr.height/2) },
    bpos: [...b.pos], rows: (b.__rows||[]).map(x => ({ slot: x.slot.name, y: x.y, h: x.h })) };
})())`))
console.log('info=', JSON.stringify(info))
await mouse('mouseMoved', info.src.x, info.src.y, 'none', 0)
await mouse('mousePressed', info.src.x, info.src.y)
await sleep(150)
console.log('after press connecting=', await ev(`(() => { const c=window.__comfyGraph.canvas; return JSON.stringify({o:!!c.connecting_output,i:!!c.connecting_input,n:!!c.connecting_node,slot:c.connecting_slot}) })()`))
for (let i=1;i<=16;i++) await mouse('mouseMoved', info.src.x+(info.tgt.x-info.src.x)*i/16, info.src.y+(info.tgt.y-info.src.y)*i/16)
await sleep(150)
console.log('over target=', await ev(`(() => {
  const c = window.__comfyGraph.canvas; const g = window.__comfyGraph.graph; const b = g.getNodeById(${info.b});
  const gm = [...c.graph_mouse];
  return JSON.stringify({ gm, hi: c._highlight_input ? [...c._highlight_input] : null,
    overNode: (g.getNodeOnPos(gm[0],gm[1],c.visible_nodes)||{}).id,
    isOverInput: c.isOverNodeInput(b, gm[0], gm[1]),
    rawOrig: (() => { try { return null } catch { return 'x' } })() });
})()`))
await mouse('mouseReleased', info.tgt.x, info.tgt.y, 'left', 0)
await sleep(400)
console.log('after up=', await ev(`(() => { const b = window.__comfyGraph.graph.getNodeById(${info.b}); return JSON.stringify(b.inputs.map(i=>({n:i.name,link:i.link}))) })()`))
ws.close(); edge.kill()
