/**
 * 验证「拖拽观感」两项调整：
 *  A. 按住/拖动节点时，其它节点的控件【不再变灰】（opacity 保持 1、pointerEvents 保持 auto）
 *  B. 拖动节点经过其它节点时，拖拽节点底色【不再透明透视】——
 *     由 .comfy-drag-cover（z-index 50000）盖住下方节点的 DOM 控件
 * 用法: node .tools/verify-nodim.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const OUT = path.join(process.cwd(), '.tools', 'browser-test');
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'vd-' + crypto.randomBytes(4).toString('hex'));
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
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
};
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
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

  console.log('=== 准备：浮点数 / 数学运算 / 数值显示 ===');
  console.log('   ' + await ev(`(() => {
    const g = window.__comfyGraph;
    g.loadWorkflow({ last_node_id: 0, last_link_id: 0, nodes: [], links: [] });
    g.addNode('PrimitiveFloat', [60, 80]);
    g.addNode('MathOp', [380, 80]);
    g.addNode('NumberDisplay', [60, 330]);
    g.fitView();
    return 'nodes=' + Object.keys(g.graph._nodes).length;
  })()`));
  await sleep(1200);
  await shot('nodim-0-before.png');

  console.log('=== 拖拽中：把 数学运算 拖到 数值显示 上 ===');
  const info = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const mo = nodes.find(n => n.type === 'MathOp');
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area, sc = g.canvas.ds.scale;
    const toScreen = (gx, gy) => [Math.round(r.left + (gx - va[0]) * sc), Math.round(r.top + (gy - va[1]) * sc)];
    return { from: toScreen(mo.pos[0] + mo.size[0] / 2, mo.pos[1] - 13), to: toScreen(nd.pos[0] + nd.size[0] / 2, nd.pos[1] + 60) };
  })())`));
  const [fx, fy] = info.from, [tx, ty] = info.to;
  await mouse('mouseMoved', fx, fy, 'none', 0);
  await mouse('mousePressed', fx, fy);
  await mouse('mouseMoved', Math.round(fx + (tx - fx) * 0.5), Math.round(fy + (ty - fy) * 0.5));
  await mouse('mouseMoved', tx, ty);
  await sleep(350);

  const mid = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const mo = nodes.find(n => n.type === 'MathOp');
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const zOf  = n => (n.widgets || []).map(w => w.element ? +getComputedStyle(w.element).zIndex : null);
    const opOf = n => (n.widgets || []).map(w => w.element ? getComputedStyle(w.element).opacity : null);
    const peOf = n => (n.widgets || []).map(w => w.element ? getComputedStyle(w.element).pointerEvents : null);
    const cover = document.querySelector('.comfy-drag-cover');
    const cr = cover ? cover.getBoundingClientRect() : null;
    // 下方节点首个控件的屏幕矩形（用来确认遮罩真的盖住了它）
    const ndw = nd.widgets[0] && nd.widgets[0].element ? nd.widgets[0].element.getBoundingClientRect() : null;
    const overlap = (cr && ndw) ? !(cr.right < ndw.left || cr.left > ndw.right || cr.bottom < ndw.top || cr.top > ndw.bottom) : false;
    return {
      dragged: g.canvas.node_dragged ? g.canvas.node_dragged.type : null,
      zMO: zOf(mo), zND: zOf(nd),
      opND: opOf(nd), opMO: opOf(mo), peND: peOf(nd),
      cover: cover ? {
        display: getComputedStyle(cover).display,
        zIndex: +getComputedStyle(cover).zIndex,
        pe: getComputedStyle(cover).pointerEvents,
        bg: getComputedStyle(cover).backgroundColor,
        w: Math.round(cr.width), h: Math.round(cr.height),
        overlap: overlap
      } : null,
      moBox: { w: Math.round(mo.size[0]), h: Math.round(mo.size[1]) },
      scale: g.canvas.ds.scale
    };
  })())`));
  console.log(JSON.stringify(mid, null, 1));

  check('拖拽态：被拖节点 = 数学运算', mid.dragged === 'MathOp', mid.dragged);
  // A. 不再淡化
  check('A 其它节点控件不再变灰（opacity≈1）', mid.opND.every(o => parseFloat(o) > 0.95), JSON.stringify(mid.opND));
  check('A 其它节点控件仍可交互（pointerEvents=auto）', mid.peND.every(p => p === 'auto'), JSON.stringify(mid.peND));
  check('A 被拖节点自身也保持不透明', mid.opMO.every(o => parseFloat(o) > 0.95), JSON.stringify(mid.opMO));
  // B. 遮罩
  check('B 拖拽遮罩已显示', !!mid.cover && mid.cover.display !== 'none');
  check('B 遮罩 z-index=50000', !!mid.cover && mid.cover.zIndex === 50000, mid.cover ? String(mid.cover.zIndex) : '');
  check('B 遮罩不拦事件（pointerEvents=none）', !!mid.cover && mid.cover.pe === 'none', mid.cover ? mid.cover.pe : '');
  check('B 遮罩不透明且已着色', !!mid.cover && /rgba?\(/.test(mid.cover.bg) && !/rgba\([^)]*,\s*0\)/.test(mid.cover.bg), mid.cover ? mid.cover.bg : '');
  check('B 遮罩尺寸 = 被拖节点 body（随缩放）', !!mid.cover &&
    Math.abs(mid.cover.w - mid.moBox.w * mid.scale) <= 2 && Math.abs(mid.cover.h - mid.moBox.h * mid.scale) <= 2,
    mid.cover ? `cover ${mid.cover.w}x${mid.cover.h} vs ${Math.round(mid.moBox.w * mid.scale)}x${Math.round(mid.moBox.h * mid.scale)}` : '');
  check('B 遮罩盖住了下方节点的控件（矩形相交）', !!mid.cover && mid.cover.overlap === true);
  // 层级：遮罩压住下方控件，被拖节点控件又压住遮罩
  check('B 下方控件 z-index < 遮罩 50000（被压住，不再透视）', mid.zND.every(z => z !== null && z < 50000), JSON.stringify(mid.zND));
  check('B 被拖节点控件 z-index > 遮罩 50000（仍在最上层）', mid.zMO.every(z => z !== null && z > 50000), JSON.stringify(mid.zMO));
  await shot('nodim-1-dragging.png');

  console.log('=== 松手后 ===');
  await mouse('mouseReleased', tx, ty, 'left', 0);
  await sleep(600);
  const after = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const mo = nodes.find(n => n.type === 'MathOp');
    const opOf = n => (n.widgets || []).map(w => w.element ? getComputedStyle(w.element).opacity : null);
    const cover = document.querySelector('.comfy-drag-cover');
    return {
      dragged: g.canvas.node_dragged ? g.canvas.node_dragged.type : null,
      coverDisplay: cover ? getComputedStyle(cover).display : null,
      opND: opOf(nd), opMO: opOf(mo),
      zMO: (mo.widgets || []).map(w => w.element ? +getComputedStyle(w.element).zIndex : null)
    };
  })())`));
  console.log(JSON.stringify(after, null, 1));
  check('松手后拖拽态清除', after.dragged === null, String(after.dragged));
  check('松手后遮罩隐藏', after.coverDisplay === 'none', String(after.coverDisplay));
  check('松手后所有控件 opacity 正常', after.opND.concat(after.opMO).every(o => parseFloat(o) > 0.95), JSON.stringify(after.opND.concat(after.opMO)));
  check('松手后被拖节点控件回到常规层级（<50000）', after.zMO.every(z => z !== null && z < 50000), JSON.stringify(after.zMO));
  await shot('nodim-2-dropped.png');

  console.log('=== console errors ===', await ev(`JSON.stringify(window.__consoleErrors || [])`));
  console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`);
  edge.kill();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); edge.kill(); process.exit(1); });
