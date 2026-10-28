/** 调试：缩放手柄命中与图片控件 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9800 + Math.floor(Math.random() * 90);
const profile = path.join(os.tmpdir(), 'probe-r-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const waiters = new Map();
const send = (method, params = {}) => { const id = ++msgId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => { waiters.set(id, { resolve: res, reject: rej }); setTimeout(() => waiters.has(id) && (waiters.delete(id), rej(new Error(method + ' timeout'))), 30000); }); };

let page;
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break; } catch { } await sleep(300); }
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); } });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
await sleep(9000);
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value; };

await ev(`(() => { const g = window.__comfyGraph; g.graph.clear(); g.addNode('TextInput', [140,160]); g.fitView(); return 1 })()`);
await sleep(800);
const info = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, n = Object.values(g.graph._nodes)[0], c = g.canvas, s = c.ds.scale, o = c.ds.offset;
  const r = c.canvas.getBoundingClientRect();
  const corner = { x: r.left + (n.pos[0] + n.size[0]) * s + o[0], y: r.top + (n.pos[1] + n.size[1]) * s + o[1] };
  return { id: n.id, scale: s, offset: o, rect: { l: r.left, t: r.top, w: r.width, h: r.height }, pos: n.pos, size: n.size, corner, min: g.minSizeOf(n) };
})())`));
console.log(JSON.stringify(info, null, 1));
const el = await ev(`(() => { const e = document.elementFromPoint(${info.corner.x - 14}, ${info.corner.y - 14}); return e ? e.tagName + '.' + e.className : 'none' })()`);
console.log('element at corner-14:', el);

// 用 pointer 事件探测 nodeAtResizeCorner
const probe = await ev(`(() => {
  const g = window.__comfyGraph; const c = g.canvas; const r = c.canvas.getBoundingClientRect();
  const fake = { clientX: ${info.corner.x - 14}, clientY: ${info.corner.y - 14} };
  const [cx, cy] = c.convertEventToCanvasOffset(fake);
  return JSON.stringify({ cx, cy });
})()`);
console.log('convertEventToCanvasOffset:', probe);

// 真实拖拽
const drag = async (x1, y1, x2, y2, steps = 10) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
await drag(info.corner.x - 14, info.corner.y - 14, info.corner.x + 100, info.corner.y + 80);
console.log('after drag size:', await ev(`JSON.stringify(window.__comfyGraph.graph._nodes[${info.id}].size)`));
console.log('cursor:', await ev(`window.__comfyGraph.canvas.canvas.style.cursor`));
console.log('resizeState:', await ev(`JSON.stringify(!!window.__comfyGraph.resizeState)`));
ws.close(); edge.kill();
