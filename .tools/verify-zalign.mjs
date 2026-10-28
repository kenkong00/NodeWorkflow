/**
 * 验证两个修复：
 *  A. 拖拽节点时其它节点的 DOM 控件不再盖住拖拽节点（z-index 跟绘制顺序 + 拖拽时其它控件淡出）
 *  B. 控件对齐：输出行独占端口行带，组件左右内缩对称（右缘 = nodeW-8 = 输出端口点右缘）
 * 用法: node .tools/verify-zalign.mjs
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
const profile = path.join(os.tmpdir(), 'vz-' + crypto.randomBytes(4).toString('hex'));
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

  console.log('=== 1) 建节点：浮点数 / 数学运算 / 数值显示 ===');
  console.log(await ev(`(() => {
    const g = window.__comfyGraph;
    g.loadWorkflow({ last_node_id: 0, last_link_id: 0, nodes: [], links: [] });
    g.addNode('PrimitiveFloat', [60, 80]);
    g.addNode('MathOp', [380, 80]);
    g.addNode('NumberDisplay', [60, 330]);
    g.fitView();
    return 'nodes=' + Object.keys(g.graph._nodes).length;
  })()`));
  await sleep(1200);

  console.log('=== 2) 对齐断言（B 修复） ===');
  const align = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const pick = t => nodes.find(n => n.type === t);
    const slotH = 26;
    const probe = n => {
      if (!n) return null;
      const outs = (n.outputs || []).length;
      let lastInRow = -1;
      (n.inputs || []).forEach((s, i) => { if (!s.widget) lastInRow = i; });
      const expectRows = Math.max(lastInRow + 1, outs);
      const expectY = Math.max(4, expectRows * slotH + 4);
      const w0 = n.widgets[0] && n.widgets[0].element;
      return {
        outs,
        wy: n.widgets_start_y,
        wyOK: Math.abs((n.widgets_start_y || 0) - expectY) <= 0.5,
        // 组件宽度 = nodeW - 16（左右各缩 8，对称）；输出点右缘 = nodeW - 8 = 组件右缘
        wpx: w0 ? w0.style.width : null,
        nodeW: Math.round(n.size[0]),
        wpxOK: w0 ? Math.abs(parseFloat(w0.style.width) - (n.size[0] - 16)) <= 0.5 : false
      };
    };
    return { pf: probe(pick('PrimitiveFloat')), mo: probe(pick('MathOp')), nd: probe(pick('NumberDisplay')) };
  })())`));
  console.log(JSON.stringify(align, null, 1));
  const allOK = [align.pf, align.mo, align.nd].every(x => x && x.wyOK && x.wpxOK);
  console.log(allOK ? 'ALIGN PASS ✓ (组件起始 y 在输出行之下；宽度=节点宽-16 左右对称)' : 'ALIGN FAIL ✗');
  await shot('zalign-1-layout.png');

  console.log('=== 3) 真实拖拽：把 数学运算 拖到 数值显示 上（A 修复） ===');
  const info = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const mo = nodes.find(n => n.type === 'MathOp');
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area;
    const sc = g.canvas.ds.scale;
    const toScreen = (gx, gy) => [Math.round(r.left + (gx - va[0]) * sc), Math.round(r.top + (gy - va[1]) * sc)];
    return {
      from: toScreen(mo.pos[0] + mo.size[0] / 2, mo.pos[1] - 13),
      to: toScreen(nd.pos[0] + nd.size[0] / 2, nd.pos[1] + 60),
      rect: { l: r.left, t: r.top, w: r.width, h: r.height }
    };
  })())`));
  const [fx, fy] = info.from;
  const [tx, ty] = info.to;
  await mouse('mouseMoved', fx, fy, 'none', 0);
  await mouse('mousePressed', fx, fy);
  await mouse('mouseMoved', fx + (tx - fx) * 0.4, fy + (ty - fy) * 0.4);
  await mouse('mouseMoved', Math.round(fx + (tx - fx) * 0.75), Math.round(fy + (ty - fy) * 0.75));
  await mouse('mouseMoved', tx, ty);
  await sleep(300);

  const mid = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const mo = nodes.find(n => n.type === 'MathOp');
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const zOf = n => (n.widgets || []).map(w => w.element ? +getComputedStyle(w.element).zIndex : null);
    const opOf = n => (n.widgets || []).map(w => w.element ? getComputedStyle(w.element).opacity : null);
    return {
      dragged: g.canvas.node_dragged ? g.canvas.node_dragged.type : null,
      zMO: zOf(mo), zND: zOf(nd),
      opND: opOf(nd), opMO: opOf(mo),
      peND: (nd.widgets[0].element ? getComputedStyle(nd.widgets[0].element).pointerEvents : null)
    };
  })())`));
  console.log(JSON.stringify(mid, null, 1));
  const zOK = mid.dragged === 'MathOp' && Math.max(...mid.zMO) > Math.max(...mid.zND);
  const dimOK = mid.opND.every(o => parseFloat(o) < 0.3) && mid.opMO.every(o => parseFloat(o) > 0.9);
  console.log((zOK ? 'Z-ORDER PASS ✓ (拖拽节点控件在最上层)' : 'Z-ORDER FAIL ✗') + ' | ' + (dimOK ? 'DIM PASS ✓ (其它节点控件已淡出)' : 'DIM FAIL ✗'));
  await shot('zalign-2-dragging.png');

  await mouse('mouseReleased', tx, ty, 'left', 0);
  await sleep(600);
  const after = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const mo = nodes.find(n => n.type === 'MathOp');
    const nd = nodes.find(n => n.type === 'NumberDisplay');
    const opOf = n => (n.widgets || []).map(w => w.element ? getComputedStyle(w.element).opacity : null);
    return { dragged: g.canvas.node_dragged ? g.canvas.node_dragged.type : null, opND: opOf(nd), opMO: opOf(mo) };
  })())`));
  const restoreOK = after.dragged === null && after.opND.every(o => parseFloat(o) > 0.9) && after.opMO.every(o => parseFloat(o) > 0.9);
  console.log(restoreOK ? 'RESTORE PASS ✓ (松手后透明度恢复、拖拽态清除)' : 'RESTORE FAIL ✗ ' + JSON.stringify(after));
  await shot('zalign-3-dropped.png');

  const errors = await ev(`JSON.stringify(window.__consoleErrors || [])`);
  console.log('=== console errors ===', errors);
  edge.kill();
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); edge.kill(); process.exit(1); });
