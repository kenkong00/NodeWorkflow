import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'agg-cdp-' + crypto.randomBytes(4).toString('hex'));
const shotDir = path.resolve('.shots');
fs.mkdirSync(shotDir, { recursive: true });

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const p = j.find(t => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(300);
  }
  throw new Error('no edge');
}

let ws, msgId = 0;
const waiters = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' timeout')); } }, 60000);
  });
}
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200);
  return r.result?.value;
};
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64')); console.log('[shot]', name); };

async function main() {
  const t = await targets();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[]; window.addEventListener('error', e => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__errs.push('rej:'+String(e.reason)));` });
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);
  console.log('errs after load:', await ev('JSON.stringify(window.__errs)'));

  // 页面内工具函数：右键搜索建节点 / 从输出端口拖线到空白搜索并自动连线
  await ev(`window.__T = {
    rightClick: (x, y) => document.querySelector('.canvas-host').dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true })),
    typeIn: (q) => { const i = document.querySelector('.nsb-input'); i.value = q; i.dispatchEvent(new Event('input')); },
    enter: () => document.querySelector('.nsb-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    esc: () => document.querySelector('.nsb-input') && document.querySelector('.nsb-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    async addBySearch(x, y, q) {
      this.rightClick(x, y); await new Promise(r => setTimeout(r, 350));
      this.typeIn(q); await new Promise(r => setTimeout(r, 250));
      const rows = document.querySelectorAll('.nsb-row').length;
      this.enter(); await new Promise(r => setTimeout(r, 350));
      return rows;
    },
    portScreen(node) {
      const g = window.__comfyGraph;
      const [gx, gy] = node.getConnectionPos(false, 0);
      const rect = g.canvas.canvas.getBoundingClientRect();
      const va = g.canvas.visible_area;
      return { x: Math.round(rect.left + (gx - va[0]) * g.canvas.ds.scale), y: Math.round(rect.top + (gy - va[1]) * g.canvas.ds.scale) };
    },
    async dragOutToBlank(node, bx, by, q) {
      const p = this.portScreen(node);
      const c = window.__comfyGraph.canvas.canvas;
      const mk = (type, x, y, buttons) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true, view: window }));
      mk('mousedown', p.x, p.y, 1);
      mk('mousemove', bx, by, 1);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: bx, clientY: by, button: 0, buttons: 0, bubbles: true, cancelable: true, view: window }));
      await new Promise(r => setTimeout(r, 500));
      if (!document.querySelector('.node-search-box')) return 'NO_SEARCH_BOX';
      this.typeIn(q); await new Promise(r => setTimeout(r, 250));
      const rows = document.querySelectorAll('.nsb-row').length;
      this.enter(); await new Promise(r => setTimeout(r, 400));
      return rows;
    },
    async dragOntoNode(srcNode, dstNode) {
      const p = this.portScreen(srcNode);
      const g = window.__comfyGraph;
      const rect = g.canvas.canvas.getBoundingClientRect();
      const va = g.canvas.visible_area;
      const dx = Math.round(rect.left + (dstNode.pos[0] + dstNode.size[0] / 2 - va[0]) * g.canvas.ds.scale);
      const dy = Math.round(rect.top + (dstNode.pos[1] + dstNode.size[1] / 2 - va[1]) * g.canvas.ds.scale);
      const c = g.canvas.canvas;
      const mk = (type, x, y, buttons) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true, view: window }));
      mk('mousedown', p.x, p.y, 1);
      mk('mousemove', dx, dy, 1);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: dx, clientY: dy, button: 0, buttons: 0, bubbles: true, cancelable: true, view: window }));
      await new Promise(r => setTimeout(r, 400));
      return 'links=' + Object.keys(g.graph.links || {}).length;
    },
    nodes: () => Object.values(window.__comfyGraph.graph._nodes),
    byType: (ty) => Object.values(window.__comfyGraph.graph._nodes).filter(n => n.type === ty),
    lastOf: (ty) => { const a = window.__T.byType(ty); return a[a.length - 1]; },
    setW: (id, name, v) => window.__comfyGraph.setWidgetValue(id, name, v),
    stats: () => ({ nodes: Object.keys(window.__comfyGraph.graph._nodes).length, links: Object.keys(window.__comfyGraph.graph.links || {}).length })
  }; 'helpers-ready'`);

  console.log('== A. 新建空画布 ==');
  await ev(`document.querySelectorAll('.topbar button')[3].click()`);
  await sleep(600);
  console.log('after new:', await ev('JSON.stringify(window.__T.stats())'));

  console.log('== B. 链1：文本 TextInput → TextDisplay ==');
  console.log('add TextInput:', await ev(`window.__T.addBySearch(420, 240, '文本输入')`));
  await ev(`window.__T.setW(window.__T.lastOf('TextInput').id, 'text', '验收测试：这条文本由 TextInput 产生，经连线送入 TextDisplay。\\n右键可搜索节点，拖端口到空白可带类型过滤搜索并自动连线。')`);
  const r1 = await ev(`window.__T.dragOutToBlank(window.__T.lastOf('TextInput'), 700, 700, '文本显示')`);
  console.log('link rows:', r1);

  console.log('== C. 链2：数值 Primitive×2 → MathOp ==');
  console.log('add P1:', await ev(`window.__T.addBySearch(950, 160, 'primitive float')`));
  await ev(`window.__T.setW(window.__T.lastOf('PrimitiveFloat').id, 'value', 6)`);
  console.log('add P2:', await ev(`window.__T.addBySearch(950, 420, 'primitive float')`));
  await ev(`window.__T.setW(window.__T.lastOf('PrimitiveFloat').id, 'value', 7)`);
  console.log('add MathOp:', await ev(`window.__T.addBySearch(950, 700, '数学运算')`));
  console.log('link P1→MathOp:', await ev(`window.__T.dragOntoNode(window.__T.byType('PrimitiveFloat')[0], window.__T.lastOf('MathOp'))`));
  console.log('link P2→MathOp:', await ev(`window.__T.dragOntoNode(window.__T.byType('PrimitiveFloat')[1], window.__T.lastOf('MathOp'))`));

  console.log('== D. 链3：图像 LoadImage → PreviewImage ==');
  console.log('add LoadImage:', await ev(`window.__T.addBySearch(1350, 240, '加载图像')`));
  await ev(`window.__T.setW(window.__T.lastOf('LoadImageNative').id, 'image', { filename: 'example.png', subfolder: '', type: 'input' })`);
  console.log('link rows:', await ev(`window.__T.dragOutToBlank(window.__T.lastOf('LoadImageNative'), 1500, 800, '预览图像')`));

  console.log('== E. 搭建结果 ==');
  console.log('stats:', await ev('JSON.stringify(window.__T.stats())'));
  console.log('types:', await ev(`JSON.stringify(window.__T.nodes().map(n => n.type))`));
  console.log('links detail:', await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph.links || {}).map(l => l ? [l.origin_id, l.origin_slot, l.target_id, l.target_slot].join('->') : 'null'))`));
  await shot('30-accept-build.png');

  console.log('== F. 保存 ==');
  await ev(`document.querySelector('.wf-name').value = '验收工作流-三链'; document.querySelector('.wf-name').dispatchEvent(new Event('input'));`);
  const before = await ev(`(async () => (await (await fetch('/api/workflows')).json()).length)()`);
  await ev(`document.querySelectorAll('.topbar button')[1].click()`);
  await sleep(1500);
  const after = await ev(`(async () => (await (await fetch('/api/workflows')).json()).length)()`);
  console.log('workflows:', before, '->', after);
  const savedName = await ev(`(async () => (await (await fetch('/api/workflows')).json()).map(w => w.name).join(','))()`);
  console.log('names:', savedName);

  console.log('== G. 真实执行 ==');
  await ev(`window.__prompts = []; const of = window.fetch; window.fetch = async function (...a) { const r = await of.apply(this, a); if (String(a[0]).includes('/prompt')) { const c = r.clone(); try { window.__prompts.push({ url: String(a[0]), body: await r.text() }); } catch (e) {} } return r; };`);
  await ev(`document.querySelector('.topbar button.primary').click()`);
  let status = '';
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    status = await ev(`(async () => { const h = await (await fetch('/history')).json(); const arr = Object.values(h); const last = arr[arr.length - 1]; return last ? JSON.stringify({ status: last.status && last.status.status_str, completed: last.status && last.status.completed, errs: last.status && last.status.messages && last.status.messages.filter(m => m[0] === 'execution_error').length }) : 'none'; })()`);
    if (status && status !== 'none' && !status.includes('running')) break;
  }
  console.log('history last:', status);
  await sleep(800);
  console.log('TextDisplay widget:', await ev(`JSON.stringify(window.__T.lastOf('TextDisplay').widgets && window.__T.lastOf('TextDisplay').widgets.map(w => w.value))`));
  console.log('Preview img:', await ev(`(() => { try { const n = window.__T.lastOf('PreviewImageNative'); const el = n.widgets[n.widgets.length - 1].element; const img = el ? el.querySelector('img') : null; return JSON.stringify({ src: img ? img.src : 'no-img', display: img ? img.style.display : null, naturalW: img ? img.naturalWidth : 0 }); } catch (e) { return 'EXC ' + e.message; } })()`));
  console.log('MathOp widgets:', await ev(`JSON.stringify(window.__T.lastOf('MathOp').widgets.map(w => w.value))`));
  console.log('prompt resp:', await ev('JSON.stringify(window.__prompts)'));
  console.log('exec btn back:', await ev(`document.querySelector('.topbar button.primary') && !document.querySelector('.topbar button.primary').disabled`));
  await shot('31-accept-executed.png');

  console.log('== H. 重开刚保存的工作流 ==');
  await ev(`document.querySelectorAll('.topbar button')[2].click()`);
  await sleep(600);
  const wfCount = await ev(`document.querySelectorAll('.modal .node-item').length`);
  const clicked = await ev(`(() => { const items = [...document.querySelectorAll('.modal .node-item')]; const hit = items.find(e => e.textContent.includes('验收工作流-三链')); if (!hit) return 'NOT_FOUND:' + items.length; hit.click(); return 'clicked'; })()`);
  console.log('reopen click:', clicked);
  await sleep(1500);
  console.log('modal items:', wfCount, 'reopen stats:', await ev('JSON.stringify(window.__T.stats())'));
  await shot('32-accept-reopened.png');

  console.log('== I. 最终错误检查 ==');
  console.log('errs:', await ev('JSON.stringify(window.__errs)'));
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch {}
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
});
