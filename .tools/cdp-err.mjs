/**
 * 带 JS 错误捕获的 CDP 诊断：加载页面前注入 window.onerror + console.error 收集器。
 * 用法: node .tools/cdp-err.mjs [url]
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
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('无法连接 Edge 调试端口');
}

let ws;
let msgId = 0;
const waiters = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    setTimeout(() => {
      if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' 超时')); }
    }, 60000);
  });
}

async function main() {
  const t = await targets();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id);
      waiters.delete(m.id);
      if (m.error) w.reject(new Error(JSON.stringify(m.error)));
      else w.resolve(m.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // 加载前注入错误收集器
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', e => {
        window.__errs.push({ kind: 'error', msg: String(e.message), src: e.filename + ':' + e.lineno + ':' + e.colno, stack: (e.error && e.error.stack || '').split('\\n').slice(0, 6).join(' | ') });
      });
      window.addEventListener('unhandledrejection', e => {
        window.__errs.push({ kind: 'rejection', msg: String(e.reason && e.reason.message || e.reason) });
      });
      const _ce = console.error;
      console.error = function(...a) { window.__errs.push({ kind: 'console.error', msg: a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '?' } }).join(' ') }); _ce.apply(console, a); };
    `
  });

  const url = process.argv[2] || 'http://localhost:5173';
  await send('Page.navigate', { url });
  await sleep(9000);

  const probe = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.value;
  };

  console.log('=== JS 错误 ===');
  console.log(await probe('JSON.stringify(window.__errs || [], null, 1)'));

  console.log('=== 画布 ===');
  console.log(await probe(`JSON.stringify((() => {
    const c = document.querySelector('canvas');
    if (!c) return 'NO_CANVAS';
    return { cls: c.className, parentCls: c.parentElement ? c.parentElement.className : '', w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, tabIndex: c.tabIndex };
  })())`));

  console.log('=== 引擎对象 ===');
  console.log(await probe(`JSON.stringify((() => ({
    hasGraph: !!window.__comfyGraph,
    hasLiteGraph: typeof window.LiteGraph !== 'undefined',
    canvasCount: document.querySelectorAll('canvas').length,
    domLayerCount: document.querySelectorAll('.canvas-host > div').length
  }))())`));

  console.log('=== 左侧面板 tab ===');
  console.log(await probe(`JSON.stringify([...document.querySelectorAll('.side-tab, [class*=tab]')].map(e => e.className + ':' + (e.textContent||'').trim().slice(0,10)))`));

  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, '11-err-diag.png'), Buffer.from(r.data, 'base64'));
  console.log('[shot] 11-err-diag.png');
}

main()
  .catch(e => { console.error('ERROR: ' + e.message); })
  .finally(async () => {
    try { ws && ws.close(); } catch { /* ignore */ }
    await sleep(200);
    try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
    await sleep(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(0);
  });
