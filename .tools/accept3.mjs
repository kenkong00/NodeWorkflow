/**
 * 画布内真实交互验收：选中 / 拖动节点 / 框选 / 平移 / 滚轮缩放 / 节点库拖入
 * 用法: node .tools/accept3.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'accept3-' + crypto.randomBytes(4).toString('hex'));
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
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); rej(new Error(method + ' timeout')); } }, 40000);
  });
};
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log(`  PASS  ${n}${d ? '  ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  ' + d : ''}`)); };

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
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result && r.result.value;
  };
  const mouse = async (type, x, y, btn = 'left', buttons = 1, modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, modifiers, clickCount: (type.endsWith('Pressed') || type.endsWith('Released')) ? 1 : 0 });
    await sleep(80);
  };
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 'left', 0); };

  // 准备：建两个节点并居
  console.log(await ev(`(() => {
    const g = window.__comfyGraph;
    g.loadWorkflow({ last_node_id: 0, last_link_id: 0, nodes: [], links: [] });
    g.addNode('TextInput', [60, 60]);
    g.addNode('MathOp', [700, 300]);
    g.fitView();
    return 'ready nodes=' + Object.keys(g.graph._nodes).length;
  })()`));
  await sleep(1000);

  const geo = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area, sc = g.canvas.ds.scale;
    const toScreen = (gx, gy) => [Math.round(r.left + (gx - va[0]) * sc), Math.round(r.top + (gy - va[1]) * sc)];
    const nodes = Object.values(g.graph._nodes).map(n => ({
      type: n.type, id: n.id, pos: [n.pos[0], n.pos[1]], size: [n.size[0], n.size[1]],
      title: toScreen(n.pos[0] + 60, n.pos[1] + 10)
    }));
    return { rect: { l: r.left, t: r.top, w: r.width, h: r.height }, nodes };
  })())`));

  console.log('\n=== 1. 单击节点标题 → 选中 ===');
  const n1 = geo.nodes[0];
  await click(n1.title[0], n1.title[1]);
  await sleep(400);
  const sel = await ev(`JSON.stringify({ n: Object.keys(window.__comfyGraph.canvas.selected_nodes || {}).length, ids: Object.keys(window.__comfyGraph.canvas.selected_nodes || {}) })`);
  check('真实单击选中节点', JSON.parse(sel).n === 1, sel);

  console.log('\n=== 2. 拖动节点 → 位置变化 ===');
  const beforePos = JSON.parse(await ev(`JSON.stringify([...Object.values(window.__comfyGraph.graph._nodes).find(n => n.type === 'TextInput').pos])`));
  const [tx, ty] = n1.title;
  await mouse('mouseMoved', tx, ty, 'none', 0);
  await mouse('mousePressed', tx, ty);
  await mouse('mouseMoved', tx + 60, ty + 50, 'left', 1);
  await mouse('mouseMoved', tx + 120, ty + 90, 'left', 1);
  await mouse('mouseReleased', tx + 120, ty + 90, 'left', 0);
  await sleep(500);
  const afterPos = JSON.parse(await ev(`JSON.stringify([...Object.values(window.__comfyGraph.graph._nodes).find(n => n.type === 'TextInput').pos])`));
  const moved = Math.abs(afterPos[0] - beforePos[0]) > 20 || Math.abs(afterPos[1] - beforePos[1]) > 20;
  check('拖动节点生效', moved, `pos ${JSON.stringify(beforePos)} → ${JSON.stringify(afterPos)}`);

  console.log('\n=== 3. 空白处拖动 → 画布平移 ===');
  const offBefore = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.canvas.ds.offset)`));
  const blank = [geo.rect.l + 120, geo.rect.t + geo.rect.h - 160];
  await mouse('mouseMoved', blank[0], blank[1], 'none', 0);
  await mouse('mousePressed', blank[0], blank[1]);
  await mouse('mouseMoved', blank[0] + 100, blank[1] - 60, 'left', 1);
  await mouse('mouseMoved', blank[0] + 180, blank[1] - 100, 'left', 1);
  await mouse('mouseReleased', blank[0] + 180, blank[1] - 100, 'left', 0);
  await sleep(500);
  const offAfter = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.canvas.ds.offset)`));
  const panned = Math.abs(offAfter[0] - offBefore[0]) > 20 || Math.abs(offAfter[1] - offBefore[1]) > 20;
  check('空白拖动平移画布', panned, `offset ${JSON.stringify(offBefore)} → ${JSON.stringify(offAfter)}`);

  console.log('\n=== 4. 框选 → 多选 ===');
  await ev(`window.__comfyGraph.canvas.deselectAllNodes(); window.__comfyGraph.fitView(); 1`);
  await sleep(700);
  const box = JSON.parse(await ev(`JSON.stringify((() => { const r = window.__comfyGraph.canvas.canvas.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })())`));
  await mouse('mouseMoved', box.l + 20, box.t + 20, 'none', 0, 2);
  await mouse('mousePressed', box.l + 20, box.t + 20, 'left', 1, 2);
  // litegraph 框选：Ctrl+空白拖动
  await mouse('mouseMoved', box.l + box.w * 0.5, box.t + box.h * 0.5, 'left', 1, 2);
  await mouse('mouseMoved', box.l + box.w * 0.8, box.t + box.h * 0.8, 'left', 1, 2);
  await mouse('mouseMoved', box.l + box.w * 0.95, box.t + box.h * 0.95, 'left', 1, 2);
  await mouse('mouseReleased', box.l + box.w * 0.95, box.t + box.h * 0.95, 'left', 0, 2);
  await sleep(500);
  const boxSel = await ev(`JSON.stringify({ n: Object.keys(window.__comfyGraph.canvas.selected_nodes || {}).length })`);
  check('框选可选中节点', JSON.parse(boxSel).n >= 1, boxSel);

  console.log('\n=== 5. 滚轮缩放 ===');
  const scaleBefore = Number(await ev(`window.__comfyGraph.canvas.ds.scale`));
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.l + box.w / 2, y: box.t + box.h / 2, deltaX: 0, deltaY: -240, button: 'none', buttons: 0 });
  await sleep(500);
  const scaleAfter = Number(await ev(`window.__comfyGraph.canvas.ds.scale`));
  check('滚轮缩放生效', Math.abs(scaleAfter - scaleBefore) > 0.01, `scale ${scaleBefore.toFixed(3)} → ${scaleAfter.toFixed(3)}`);

  console.log('\n=== 6. 左侧节点库拖到画布（HTML5 DnD） ===');
  // 切到节点库 tab 并确认可拖
  await ev(`(() => { const t = [...document.querySelectorAll('.lp-tab')].find(e => e.textContent.includes('节点库')); if (t) t.click(); return 1; })()`);
  await sleep(600);
  const dragSrc = await ev(`JSON.stringify((() => {
    const els = [...document.querySelectorAll('[draggable="true"]')];
    return { count: els.length, sample: els.slice(0, 3).map(e => e.textContent.trim().slice(0, 16)) };
  })())`);
  check('节点库条目可拖拽', JSON.parse(dragSrc).count > 0, dragSrc);

  // 用真实 DataTransfer 合成 drop（HTML5 DnD 在 CDP 里的标准做法）
  const dropRes = await ev(`(() => {
    const host = document.querySelector('.canvas-host');
    const type = 'MathOp';
    const dt = new DataTransfer();
    dt.setData('text/comfy-node-type', type);
    const rect = host.getBoundingClientRect();
    const x = rect.left + rect.width * 0.35, y = rect.top + rect.height * 0.7;
    const before = Object.keys(window.__comfyGraph.graph._nodes).length;
    for (const t of ['dragenter', 'dragover']) {
      host.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    const after = Object.keys(window.__comfyGraph.graph._nodes).length;
    return JSON.stringify({ before, after, types: Object.values(window.__comfyGraph.graph._nodes).map(n => n.type) });
  })()`);
  const dr = JSON.parse(dropRes);
  check('节点库拖入创建节点', dr.after > dr.before, `${dr.before} → ${dr.after}  ${dr.types.join(',')}`);

  console.log('\n=== 7. 画布命中自检（小地图不得遮挡） ===');
  const hitCheck = await ev(`(() => {
    const g = window.__comfyGraph;
    const r = g.canvas.canvas.getBoundingClientRect();
    const mm = document.querySelector('canvas.minimap');
    const mmBox = mm ? mm.getBoundingClientRect() : null;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const elMm = document.elementFromPoint(600, 600);
    return JSON.stringify({
      center: el ? el.tagName + '.' + (el.className || '') : 'NULL',
      minimapVisible: mm ? mm.offsetParent !== null : false,
      minimapSize: mmBox ? [Math.round(mmBox.width), Math.round(mmBox.height)] : null,
      elAtCanvas: elMm ? elMm.tagName + '.' + (elMm.className || '') : 'NULL'
    });
  })()`);
  const hc = JSON.parse(hitCheck);
  check('小地图不铺满画布', !hc.minimapVisible || (hc.minimapSize && hc.minimapSize[0] <= 300), JSON.stringify(hc.minimapSize));
  check('画布空白区域确实命中主画布', !/minimap/.test(String(hc.elAtCanvas)), String(hc.elAtCanvas));

  console.log('\n=== 8. 导出 ===');
  const durl = await ev(`window.__comfyGraph.canvas.canvas.toDataURL('image/png')`);
  if (durl && durl.startsWith('data:')) {
    fs.writeFileSync(path.resolve('.shots/62-accept3-canvas.png'), Buffer.from(durl.split(',')[1], 'base64'));
    console.log('  [canvas] .shots/62-accept3-canvas.png');
  }
  const logs = JSON.parse(await ev(`JSON.stringify(window.__logs || [])`));
  check('无 console 报错', !logs.some(x => /^error:/.test(x)), logs.slice(0, 2).join(' | '));

  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch { }
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  process.exit(fail > 0 ? 1 : 0);
});
