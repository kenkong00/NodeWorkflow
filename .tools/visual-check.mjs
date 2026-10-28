/**
 * 视觉验证专用：从 canvas 2D 缓冲直接提取画布图像（toDataURL），
 * 绕过无头截图不捕获 canvas 的限制；同时输出 DOM 控件层信息。
 */
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

const edge = spawn(EDGE, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
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
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' timeout')); } }, 120000);
  });
}
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200);
  return r.result?.value;
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
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);

  // 加载「验收工作流-三链」
  const loaded = await ev(`(async () => {
    const ws = await (await fetch('/api/workflows')).json();
    const w = ws.find(x => x.name === '验收工作流-三链');
    if (!w) return 'NO_WF';
    const row = await (await fetch('/api/workflows/' + w.id)).json();
    window.__comfyGraph.loadWorkflow(JSON.parse(row.graph_json));
    window.__comfyGraph.fitView();
    return 'loaded ' + w.id + ' nodes=' + Object.keys(window.__comfyGraph.graph._nodes).length;
  })()`);
  console.log('load:', loaded);
  await sleep(2000);

  // 执行（产生文本/图片结果）
  await ev(`document.querySelector('.topbar button.primary').click(); 'run'`);
  await sleep(5000);

  // 提取 canvas 像素
  const dataUrl = await ev(`window.__comfyGraph.canvas.canvas.toDataURL('image/png')`);
  if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
    const b64 = dataUrl.slice('data:image/png;base64,'.length);
    fs.writeFileSync(path.join(shotDir, '40-canvas-extract.png'), Buffer.from(b64, 'base64'));
    console.log('[canvas-extract] 40-canvas-extract.png', Buffer.from(b64, 'base64').length, 'bytes');
  } else {
    console.log('toDataURL failed:', String(dataUrl).slice(0, 100));
  }

  // DOM 控件层摘要（节点内控件状态）
  console.log('dom widgets:', await ev(`JSON.stringify([...document.querySelectorAll('.canvas-host .lg-dom-widget')].map(e => ({ cls: e.className, txt: (e.textContent || '').slice(0, 40), hasImg: !!e.querySelector('img'), imgW: (e.querySelector('img') || {}).naturalWidth || 0 })))`));

  // 同时试一次普通截图（swiftshader 模式）
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, '41-shot-swiftshader.png'), Buffer.from(r.data, 'base64'));
  console.log('[shot] 41-shot-swiftshader.png');
}

main().catch(e => console.error('ERROR: ' + e.message)).finally(async () => {
  try { ws && ws.close(); } catch {}
  await sleep(200);
  try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
});
