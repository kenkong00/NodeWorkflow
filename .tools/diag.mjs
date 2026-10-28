/**
 * 诊断版 CDP：预注入错误收集 + 捕获 Runtime.exceptionThrown / Log 条目
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'agg-cdp-' + crypto.randomBytes(4).toString('hex'));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,900',
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
    }, 30000);
  });
}

async function main() {
  const t = await targets();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id);
      waiters.delete(m.id);
      if (m.error) w.reject(new Error(JSON.stringify(m.error)));
      else w.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception?.description || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      logs.push('[log] ' + m.params.entry.text + ' @ ' + (m.params.entry.url || ''));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  // 预注入：收集 window.onerror 与未处理 Promise 拒绝
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', e => window.__errs.push('[onerror] ' + e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||0)));
      window.addEventListener('unhandledrejection', e => window.__errs.push('[unhandledrejection] ' + String(e.reason && e.reason.stack || e.reason)));
    `
  });

  const url = process.env.URL || 'http://127.0.0.1:5173';
  await send('Page.navigate', { url });
  await sleep(Number(process.env.NAVWAIT || 6000));

  if (process.env.EXEC) {
    const steps = JSON.parse(fs.readFileSync(process.env.EXEC, 'utf8'));
    for (const s of steps) {
      if (s.wait) { await sleep(s.wait); continue; }
      if (s.eval) {
        const rr = await send('Runtime.evaluate', { expression: s.eval, returnByValue: true, awaitPromise: true });
        console.log('[exec] ' + (rr.result.value ?? rr.exceptionDetails?.exception?.description ?? 'null'));
      }
    }
  }

  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ errs: window.__errs, hostChildren: [...document.querySelector('.canvas-host')?.children||[]].map(c=>c.tagName+'.'+c.className) })`,
    returnByValue: true
  });
  console.log('[page-errs] ' + r.result.value);
  console.log('[cdp-logs]');
  for (const l of logs.slice(0, 30)) console.log('  ' + l);
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
