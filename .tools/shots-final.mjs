/** 终版截图：运行示例、右键菜单、缩放手柄、另存为 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9650 + Math.floor(Math.random() * 40);
const profile = path.join(os.tmpdir(), 'shots-' + crypto.randomBytes(4).toString('hex'));
const shotDir = path.resolve('.shots');
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const waiters = new Map();
const send = (m, p = {}) => { const id = ++msgId; ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((res, rej) => { waiters.set(id, { resolve: res, reject: rej }); setTimeout(() => waiters.has(id) && (waiters.delete(id), rej(new Error(m + ' timeout'))), 60000); }); };
let page;
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break; } catch { } await sleep(300); }
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); } if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { }); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
await sleep(9000);
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : r.result.value; };
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, n), Buffer.from(r.data, 'base64')); };
const mouse = async (type, x, y, btn = 'left', buttons = 1) => { await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }); await sleep(60); };
const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const center = async (sel, idx = 0) => JSON.parse(await ev(`JSON.stringify((() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]; if(!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })())`));

// 1. 载入三链合一并运行
const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'));
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`);
await sleep(2200);
await shot('95-final-workflow.png');

const runBtn = await center('.run-btn');
await click(runBtn.x, runBtn.y);
await sleep(2600);
await shot('96-final-run.png');

// 2. 右键菜单（点节点标题）
const nr = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = Object.values(g.graph._nodes)[0];
  const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left + (n.pos[0] + o[0]) * s + 80), y: Math.round(r.top + (n.pos[1] + o[1]) * s - 14) };
})())`));
await mouse('mouseMoved', nr.x, nr.y, 'none', 0);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nr.x, y: nr.y, button: 'right', buttons: 2, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nr.x, y: nr.y, button: 'right', buttons: 0, clickCount: 1 });
await sleep(500);
await shot('97-final-nodemenu.png');
await ev(`document.querySelector('.ctx-mask') && document.querySelector('.ctx-mask').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);

// 3. 缩放手柄悬停
await sleep(300);
const corner = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = Object.values(g.graph._nodes)[0];
  const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
  return { x: Math.round(r.left + (n.pos[0] + n.size[0] + o[0]) * s - 16), y: Math.round(r.top + (n.pos[1] + n.size[1] + o[1]) * s - 16) };
})())`));
await mouse('mouseMoved', corner.x, corner.y, 'none', 0);
await sleep(500);
await shot('98-final-resize-hover.png');

// 4. 另存为对话框
const sa = await center('.rail .icon-btn', 3);
await click(sa.x, sa.y);
await sleep(600);
await shot('99-final-saveas.png');

ws.close(); edge.kill();
console.log('shots done');
