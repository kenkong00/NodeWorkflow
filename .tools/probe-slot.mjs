/** 调试：组件隐藏端口命中 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 40);
const profile = path.join(os.tmpdir(), 'probe-s-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const waiters = new Map();
const send = (m, p = {}) => { const id = ++msgId; ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((res, rej) => { waiters.set(id, { resolve: res, reject: rej }); setTimeout(() => waiters.has(id) && (waiters.delete(id), rej(new Error(m + ' timeout'))), 30000); }); };
let page;
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break; } catch { } await sleep(300); }
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); } });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
await sleep(9000);
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value; };

await ev(`(() => {
  const g = window.__comfyGraph; g.graph.clear();
  g.addNode('PrimitiveInt', [80, 120]); g.addNode('ImageScale', [520, 120]); g.fitView();
  window.__probe = [];
  const c = g.canvas;
  const orig = c.isOverNodeInput.bind(c);
  c.isOverNodeInput = function (node, x, y, sp) { const r = orig(node, x, y, sp); window.__probe.push({ x: Math.round(x), y: Math.round(y), r, conn: !!this.connecting_node, id: node && node.id }); return r; };
  return 1;
})()`);
await sleep(900);
const ids = JSON.parse(await ev(`JSON.stringify((() => { const ns = Object.values(window.__comfyGraph.graph._nodes); return { a: ns.find(n=>n.type==='PrimitiveInt').id, b: ns.find(n=>n.type==='ImageScale').id }; })())`));
const info = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = g.graph.getNodeById(${ids.a});
  const p = n.getConnectionPos(false, 0); const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  const nb = g.graph.getNodeById(${ids.b});
  const w = nb.widgets.find(x=>x.name==='width'); const wr = w.element.getBoundingClientRect();
  return { src: { x: Math.round(r.left + (p[0]+o[0])*s), y: Math.round(r.top + (p[1]+o[1])*s) }, dst: { x: Math.round(wr.left+6), y: Math.round(wr.top+wr.height/2) }, scale: s, offset: o, rows: (nb.__rows||[]).map(x=>({t:String(x.slot.type), y:x.y, h:x.h})) };
})())`));
console.log(JSON.stringify(info));
const drag = async (x1, y1, x2, y2, steps = 16) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, button: 'left', buttons: 1 });
  // 停在目标点一小会儿，让 draw 跑几帧（隐藏端口只在悬停节点时绘制/记录）
  await sleep(400);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
};
// 先按下并检查是否进入拖线状态
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.src.x, y: info.src.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.src.x, y: info.src.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(200);
console.log('hitTest:', await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas, n = g.graph.getNodeById(${ids.a});
  const pt = { clientX: ${info.src.x}, clientY: ${info.src.y} };
  const [cx, cy] = c.convertEventToCanvasOffset(pt);
  return { cx, cy, overOut: c.isOverNodeOutput(n, cx, cy), overIn: c.isOverNodeInput(n, cx, cy), el: (document.elementFromPoint(${info.src.x}, ${info.src.y}) || {}).className };
})())`));
console.log('after press connecting:', await ev("JSON.stringify({ c: !!window.__comfyGraph.canvas.connecting_node, d: !!window.__comfyGraph.canvas.node_dragged, sel: Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).length })"));
console.log('node pos/size:', await ev(`JSON.stringify((() => { const n = window.__comfyGraph.graph.getNodeById(${ids.a}); return { pos: n.pos, size: n.size, out: n.outputs && n.outputs.length, cpos: Array.from(n.getConnectionPos(false,0)) }; })())`));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.dst.x, y: info.dst.y, button: 'left', buttons: 1 });
await sleep(400);
console.log('probeMid:', await ev(`JSON.stringify(window.__probe.slice(-5))`));
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.dst.x, y: info.dst.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(300);
console.log('probe:', await ev(`JSON.stringify(window.__probe.slice(-8))`));
console.log('links:', await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(${ids.b}).inputs.map(i=>i.link))`));
console.log('connAfter:', await ev(`JSON.stringify(!!window.__comfyGraph.canvas.connecting_node)`));
ws.close(); edge.kill();
