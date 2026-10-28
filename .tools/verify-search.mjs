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

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,1000',
  'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find(t => t.type === 'page');
      if (page) return page;
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
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const mouse = async (type, x, y, btn = 'none', clicks = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: btn, clickCount: clicks, buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 1 : 0 });
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

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

  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(String(e.message) + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno));
    window.addEventListener('unhandledrejection', e => window.__errs.push('rej: ' + String(e.reason)));
  `});
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);

  console.log('== 1. 加载与错误 ==');
  console.log('errs:', await ev('JSON.stringify(window.__errs)'));
  console.log('graph:', await ev('!!window.__comfyGraph'));

  console.log('== 2. 右键画布空白 (700,420) ==');
  await mouse('mousePressed', 700, 420, 'right');
  await sleep(600);
  console.log('searchBox:', await ev('(() => { const b = document.querySelector(".node-search-box"); return b ? "shown left=" + b.style.left + " top=" + b.style.top : "MISSING"; })()'));
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(shotDir, '20-right-click.png'), Buffer.from(r.data, 'base64')));

  console.log('== 3. 输入 text 过滤 ==');
  await ev(`(() => { const i = document.querySelector('.nsb-input'); i.value = 'text'; i.dispatchEvent(new Event('input')); return 'typed'; })()`);
  await sleep(400);
  console.log('rows:', await ev('document.querySelectorAll(".nsb-row").length'));
  console.log('first3:', await ev('JSON.stringify([...document.querySelectorAll(".nsb-row .nm")].slice(0,3).map(e => e.textContent))'));

  console.log('== 4. ↑↓ + Enter 放置 ==');
  await key('ArrowDown', 'ArrowDown', 40);
  await key('Enter', 'Enter', 13);
  await sleep(600);
  console.log('boxClosed:', await ev('!document.querySelector(".node-search-box")'));
  console.log('nodes:', await ev('Object.keys(window.__comfyGraph.graph._nodes).length'));
  console.log('nodeType:', await ev('(() => { const ns = Object.values(window.__comfyGraph.graph._nodes); return ns.map(n => n.type).join(","); })()'));
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(shotDir, '21-search-added.png'), Buffer.from(r.data, 'base64')));

  console.log('== 5. 打开对话框 → 示例① ==');
  await ev(`document.querySelectorAll('.topbar button')[2].click()`);
  await sleep(600);
  console.log('modal:', await ev('!!document.querySelector(".modal-mask")'));
  console.log('examples:', await ev('JSON.stringify([...document.querySelectorAll(".modal .node-item span:nth-child(2)")].map(e => e.textContent).slice(0,4))'));
  await ev(`[...document.querySelectorAll('.modal .node-item')].find(e => e.textContent.includes('文本传递')).click()`);
  await sleep(1500);
  console.log('after example nodes:', await ev('Object.keys(window.__comfyGraph.graph._nodes).length'));
  console.log('after example links:', await ev('Object.keys(window.__comfyGraph.graph.links || {}).length'));
  console.log('wfName:', await ev(`document.querySelector('.wf-name').value`));
  await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(shotDir, '22-example-loaded.png'), Buffer.from(r.data, 'base64')));

  console.log('== 6. Esc 关闭 + 再右键测「无匹配」 ==');
  await mouse('mousePressed', 700, 420, 'right');
  await sleep(400);
  await ev(`(() => { const i = document.querySelector('.nsb-input'); i.value = 'zzzznomatch'; i.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(300);
  console.log('emptyTip:', await ev('!!document.querySelector(".nsb-empty")'));
  await key('Escape', 'Escape', 27);
  await sleep(300);
  console.log('escClosed:', await ev('!document.querySelector(".node-search-box")'));
  console.log('errs final:', await ev('JSON.stringify(window.__errs)'));
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch {}
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
});
