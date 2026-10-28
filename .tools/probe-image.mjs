/** 调试：图片控件尺寸 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9750 + Math.floor(Math.random() * 90);
const profile = path.join(os.tmpdir(), 'probe-i-' + crypto.randomBytes(4).toString('hex'));
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

const wf = JSON.parse(fs.readFileSync('public/examples/03-图像预览.json', 'utf8'));
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`);
await sleep(1800);
console.log(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = Object.values(g.graph._nodes)[0];
  return (n.widgets || []).map(w => ({ type: w.type, name: w.name, flex: !!(w.options && w.options.flexible), min: w.options && w.options.minHeight, el: !!w.element, w: w.element && w.element.style.width, h: w.element && w.element.style.height, rect: w.element && { w: Math.round(w.element.getBoundingClientRect().width), h: Math.round(w.element.getBoundingClientRect().height) }, cls: w.element && w.element.className }));
})())`));
const nid = await ev(`Object.values(window.__comfyGraph.graph._nodes)[0].id`);
await ev(`(() => { const n = window.__comfyGraph.graph.getNodeById(${nid}); n.setSize([600, 520]); return 1 })()`);
await sleep(800);
console.log('after resize:', await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(${nid});
  return (n.widgets || []).map(w => ({ type: w.type, w: w.element && w.element.style.width, h: w.element && w.element.style.height, rect: w.element && { w: Math.round(w.element.getBoundingClientRect().width), h: Math.round(w.element.getBoundingClientRect().height) }, img: w.element && w.element.querySelector('img') ? (() => { const r = w.element.querySelector('img').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })() : null, last_y: w.last_y }));
})())`));
ws.close(); edge.kill();
