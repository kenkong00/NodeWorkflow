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
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300);
  return r.result?.value;
};
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64')); };

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

  // 先通过示例①建两个连通节点（TextInput → TextDisplay）
  await ev(`(async () => { const r = await fetch('/examples/01-文本传递.json'); const j = await r.json(); window.__comfyGraph.loadWorkflow(j); return 'loaded'; })()`);
  await sleep(1200);
  console.log('== 0. 示例预载 ==');
  console.log('nodes:', await ev('Object.keys(window.__comfyGraph.graph._nodes).length'), 'links:', await ev('Object.keys(window.__comfyGraph.graph.links||{}).length'));

  console.log('== 1. 右键画布 → 输入 math → Enter 放置 ==');
  await ev(`document.querySelector('.canvas-host').dispatchEvent(new MouseEvent('contextmenu', { clientX: 640, clientY: 420, bubbles: true, cancelable: true }))`);
  await sleep(500);
  console.log('box:', await ev('!!document.querySelector(".node-search-box")'));
  await ev(`(() => { const i = document.querySelector('.nsb-input'); i.value = 'math'; i.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(300);
  console.log('rows(math):', await ev('document.querySelectorAll(".nsb-row").length'));
  console.log('top:', await ev('document.querySelector(".nsb-row .nm")?.textContent'));
  await ev(`(() => { const i = document.querySelector('.nsb-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()`);
  await sleep(500);
  console.log('closed:', await ev('!document.querySelector(".node-search-box")'), 'nodes:', await ev('Object.keys(window.__comfyGraph.graph._nodes).length'));

  console.log('== 2. 多词搜索规则（空格分词） ==');
  await ev(`document.querySelector('.canvas-host').dispatchEvent(new MouseEvent('contextmenu', { clientX: 640, clientY: 420, bubbles: true, cancelable: true }))`);
  await sleep(400);
  await ev(`(() => { const i = document.querySelector('.nsb-input'); i.value = '文本 输入'; i.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(300);
  console.log('rows(文本 输入):', await ev('document.querySelectorAll(".nsb-row").length'), 'top:', await ev('document.querySelector(".nsb-row .nm")?.textContent'));
  await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await sleep(300);

  console.log('== 3. 拖线到空白 → 带类型过滤的搜索框 ==');
  // TextInput 输出端口屏幕坐标
  const port = await ev(`(() => {
    const g = window.__comfyGraph;
    const node = Object.values(g.graph._nodes).find(n => n.type === 'TextInput');
    if (!node) return null;
    const [gx, gy] = node.getConnectionPos(false, 0);
    const rect = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area;
    return { x: Math.round(rect.left + (gx - va[0]) * g.canvas.ds.scale), y: Math.round(rect.top + (gy - va[1]) * g.canvas.ds.scale) };
  })()`);
  console.log('port screen pos:', JSON.stringify(port));
  if (port) {
    await ev(`(() => {
      const c = window.__comfyGraph.canvas.canvas;
      const mk = (type, x, y) => c.dispatchEvent(new MouseEvent(type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : 'mousemove', { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, view: window }));
      mk('pointerdown', ${port.x}, ${port.y});
      mk('pointermove', ${port.x + 40}, ${port.y + 60});
      mk('pointermove', 1180, 860);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 1180, clientY: 860, button: 0, buttons: 0, bubbles: true, cancelable: true, view: window }));
      return 'dragged';
    })()`);
    await sleep(700);
    console.log('searchAfterDrop:', await ev('!!document.querySelector(".node-search-box")'));
    console.log('filterLabel:', await ev('document.querySelector(".nsb-filter")?.textContent'));
    console.log('rows(STRING-filtered):', await ev('document.querySelectorAll(".nsb-row").length'));
    console.log('allRowsAcceptSTRING:', await ev(`(() => {
      const g = window.__comfyGraph;
      const rows = [...document.querySelectorAll('.nsb-row .cat')].map(e => e.textContent);
      return rows.slice(0, 8).join(' | ');
    })()`));
    await shot('23-link-drop-search.png');
    // 选中第一项 → 建节点 + 自动连线
    await ev(`(() => { const i = document.querySelector('.nsb-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(700);
    console.log('afterPick nodes:', await ev('Object.keys(window.__comfyGraph.graph._nodes).length'), 'links:', await ev('Object.keys(window.__comfyGraph.graph.links||{}).length'));
    const lastType = await ev('(() => { const ns = Object.values(window.__comfyGraph.graph._nodes); return ns[ns.length - 1].type; })()');
    console.log('pickedType:', lastType);
    await shot('24-auto-connected.png');
  }

  console.log('== 4. 双击画布也弹搜索 ==');
  await ev(`(() => { const h = document.querySelector('.canvas-host'); h.dispatchEvent(new MouseEvent('dblclick', { clientX: 500, clientY: 500, bubbles: true })); return 1; })()`);
  await sleep(400);
  console.log('dblclickBox:', await ev('!!document.querySelector(".node-search-box")'));
  await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);

  console.log('== 5. 示例②③ 打开 ==');
  for (const [f, label] of [['02-数值运算.json', '数值运算'], ['03-图像预览.json', '图像预览']]) {
    const r = await ev(`(async () => { const res = await fetch('/examples/${f}'); const j = await res.json(); window.__comfyGraph.loadWorkflow(j); return Object.keys(window.__comfyGraph.graph._nodes).length + 'n/' + Object.keys(window.__comfyGraph.graph.links||{}).length + 'l'; })()`);
    console.log(f, '->', r);
    await sleep(600);
  }
  await shot('25-example3.png');
  console.log('== errs ==', await ev('JSON.stringify(window.__errs)'));
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch {}
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
});
