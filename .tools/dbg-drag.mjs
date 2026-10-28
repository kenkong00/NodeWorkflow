/**
 * 定向调试：真实鼠标从输出端口拖到空白，检查拖线是否起始
 * 用法: node .tools/dbg-drag.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'dbgdrag-' + crypto.randomBytes(4).toString('hex'));
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
    await sleep(90);
  };

  // 直接放两个节点（用 API 保证位置可控）
  console.log(await ev(`(() => {
    const g = window.__comfyGraph;
    g.loadWorkflow({ last_node_id: 0, last_link_id: 0, nodes: [], links: [] });
    g.addNode('TextInput', [100, 100]);
    g.addNode('TextDisplay', [700, 100]);
    g.fitView();
    return 'built nodes=' + Object.keys(g.graph._nodes).length;
  })()`));
  await sleep(900);

  const info = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const n = Object.values(g.graph._nodes).find(x => x.type === 'TextInput');
    const [gx, gy] = n.getConnectionPos(false, 0);
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area;
    const sc = g.canvas.ds.scale;
    return {
      scale: sc, offset: g.canvas.ds.offset, va,
      rect: { l: r.left, t: r.top, w: r.width, h: r.height },
      graphPos: [gx, gy],
      screen: [Math.round(r.left + (gx - va[0]) * sc), Math.round(r.top + (gy - va[1]) * sc)],
      outRect: n.outputs && n.outputs[0] ? { type: n.outputs[0].type, links: n.outputs[0].links } : null,
      nodeSize: n.size, nodePos: n.pos
    };
  })())`));
  console.log('port info:', JSON.stringify(info));

  const [sx, sy] = info.screen;
  console.log('--- 尝试 1: mousedown 在端口坐标 ---');
  await mouse('mouseMoved', sx, sy, 'none', 0);
  await mouse('mousePressed', sx, sy);
  console.log('  after down:', await ev(`JSON.stringify({ connecting: !!window.__comfyGraph.canvas.connecting_node, out: window.__comfyGraph.canvas.connecting_output && window.__comfyGraph.canvas.connecting_output.type, slot: window.__comfyGraph.canvas.connecting_slot })`));

  if (!(await ev(`!!window.__comfyGraph.canvas.connecting_node`))) {
    console.log('--- 端口未命中，扫描端口附近 ±8px ---');
    let hit = null;
    outer: for (let dx = -8; dx <= 8; dx += 2) {
      for (let dy = -8; dy <= 8; dy += 2) {
        await mouse('mouseMoved', sx + dx, sy + dy, 'none', 0);
        await mouse('mousePressed', sx + dx, sy + dy);
        const ok = await ev(`!!window.__comfyGraph.canvas.connecting_node`);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + dx, y: sy + dy, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(60);
        if (ok) { hit = { dx, dy }; console.log('  命中偏移:', dx, dy); break outer; }
        // 清掉可能产生的选择状态
        await ev(`window.__comfyGraph.canvas.connecting_node = null`);
      }
    }
    if (!hit) console.log('  ±8px 内均未命中端口');
  }

  // 重置并做完整拖拽
  await ev(`(() => { const c = window.__comfyGraph.canvas; c.connecting_node = null; c.connecting_output = null; c.connecting_input = null; c.connecting_slot = null; c.connecting_pos = null; return 1; })()`);
  await sleep(300);
  console.log('--- 尝试 2: 完整拖拽到空白 ---');
  await mouse('mouseMoved', sx, sy, 'none', 0);
  await mouse('mousePressed', sx, sy);
  const okStart = await ev(`!!window.__comfyGraph.canvas.connecting_node`);
  console.log('  drag started:', okStart);
  const tx = Math.round(info.rect.l + info.rect.w - 200);
  const ty = Math.round(info.rect.t + info.rect.h - 150);
  await mouse('mouseMoved', (sx + tx) / 2, (sy + ty) / 2, 'left', 1);
  await mouse('mouseMoved', tx, ty, 'left', 1);
  console.log('  hovering blank, connecting still:', await ev(`!!window.__comfyGraph.canvas.connecting_node`));
  await mouse('mouseReleased', tx, ty, 'left', 0);
  await sleep(700);
  console.log('  searchBox:', await ev(`JSON.stringify({ shown: !!document.querySelector('.node-search-box'), filter: (document.querySelector('.nsb-filter')||{}).textContent || '', rows: document.querySelectorAll('.nsb-row').length })`));
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch { }
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  process.exit(0);
});
