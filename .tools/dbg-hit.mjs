/**
 * 决定性诊断：真实鼠标事件的 target 是谁？canvas 是否收到 mousedown？
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'dbghit-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, msgId = 0;
const waiters = new Map();
const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    waiters.set(id, { res, rej });
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); rej(new Error(method + ' timeout')); } }, 30000);
  });
};

async function main() {
  let t;
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = j.find(x => x.type === 'page'); if (t) break; } catch { }
    await sleep(300);
  }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result && r.result.value;
  };
  const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: (type.endsWith('Pressed') || type.endsWith('Released')) ? 1 : 0 });
    await sleep(80);
  };

  // 装事件探针
  console.log(await ev(`(() => {
    window.__probe = [];
    const rec = (tag) => (e) => window.__probe.push(tag + ' target=' + (e.target && e.target.tagName) + '.' + (e.target && e.target.className || '') + ' cx=' + Math.round(e.clientX) + ' cy=' + Math.round(e.clientY) + ' canvasX=' + (e.canvasX != null ? Math.round(e.canvasX) : '-'));
    document.addEventListener('mousedown', rec('DOC-down'), true);
    document.addEventListener('mouseup', rec('DOC-up'), true);
    const g = window.__comfyGraph;
    const cs = [...document.querySelectorAll('.canvas-host canvas')];
    cs.forEach((c, i) => c.addEventListener('mousedown', rec('CANVAS' + i + '-down'), true));
    // 打印所有覆盖层的几何与 pointer-events
    const stack = [...document.querySelectorAll('.canvas-host, .canvas-host > *')].map(el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return { tag: el.tagName + '.' + (el.className || ''), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), pe: st.pointerEvents, z: st.zIndex, pos: st.position };
    });
    return JSON.stringify({ canvasCount: cs.length, stack });
  })()`));

  // 找主画布与端口
  const info = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    g.loadWorkflow({ last_node_id: 0, last_link_id: 0, nodes: [], links: [] });
    g.addNode('TextInput', [100, 100]);
    g.fitView();
    const n = Object.values(g.graph._nodes)[0];
    const [gx, gy] = n.getConnectionPos(false, 0);
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area;
    const sc = g.canvas.ds.scale;
    return { gx, gy, sx: Math.round(r.left + (gx - va[0]) * sc), sy: Math.round(r.top + (gy - va[1]) * sc) };
  })())`));
  const { sx, sy } = info;
  console.log('端口屏幕坐标:', sx, sy);
  console.log('elementFromPoint:', await ev(`(() => { const el = document.elementFromPoint(${sx}, ${sy}); if (!el) return 'NULL'; const st = getComputedStyle(el); return el.tagName + '.' + el.className + ' z=' + st.zIndex + ' pe=' + st.pointerEvents; })()`));

  // 真实点击
  await mouse('mouseMoved', sx, sy, 'none', 0);
  await mouse('mousePressed', sx, sy);
  await mouse('mouseReleased', sx, sy, 'left', 0);
  await sleep(400);
  console.log('探针记录:', await ev(`JSON.stringify(window.__probe, null, 1)`));
  console.log('connecting:', await ev(`JSON.stringify({ cn: !!window.__comfyGraph.canvas.connecting_node, sel: Object.keys(window.__comfyGraph.canvas.selected_nodes || {}).length })`));
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch { }
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  process.exit(0);
});
