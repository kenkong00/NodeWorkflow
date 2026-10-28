/**
 * 用户环境全真复现：真实鼠标事件（Input.dispatchMouseEvent）+ 全 console 捕获
 * 用法: node .tools/repro.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'repro-cdp-' + crypto.randomBytes(4).toString('hex'));
const shotDir = path.resolve('.shots');
fs.mkdirSync(shotDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
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
  // alert/confirm 自动点掉，避免阻塞 CDP
  await send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });

  // 全量 console 捕获（warn 也要——Vue 的 onBeforeUnmount 警告就是 warn）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__logs = [];
      for (const lvl of ['log', 'warn', 'error', 'info']) {
        const orig = console[lvl];
        console[lvl] = function(...a) {
          window.__logs.push({ lvl: '${' + lvl + '}', msg: a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '?' } }).join(' ').slice(0, 300) });
          orig.apply(console, a);
        };
      }
      window.addEventListener('error', e => window.__logs.push({ lvl: 'error', msg: String(e.message) + ' @' + e.filename + ':' + e.lineno }));
      window.addEventListener('unhandledrejection', e => window.__logs.push({ lvl: 'rejection', msg: String(e.reason && e.reason.message || e.reason) }));
    `
  });

  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(10000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  };
  // 真实鼠标
  const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
    await send('Input.dispatchMouseEvent', {
      type, x, y, button: btn, buttons,
      clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0
    });
    await sleep(120);
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64'));
    console.log('[shot] ' + name);
  };

  console.log('=== 1. 页面骨架 ===');
  console.log(await ev(`JSON.stringify({
    appShell: !!document.querySelector('.app-shell'),
    topbarBtns: document.querySelectorAll('.topbar button').length,
    topbarTexts: [...document.querySelectorAll('.topbar button')].map(b => b.textContent.trim()),
    canvasHost: !!document.querySelector('.canvas-host'),
    canvases: document.querySelectorAll('canvas').length,
    leftPanel: !!document.querySelector('.side-panel, [class*=panel]'),
    bodyChildren: document.body.children.length,
    appHtml: document.getElementById('app') ? document.getElementById('app').innerHTML.length : 0
  })`));

  console.log('=== 2. console 输出（加载期） ===');
  console.log(await ev('JSON.stringify(window.__logs)'));

  console.log('=== 3. 顶栏按钮真实点击测试 ===');
  // 按钮 1 = 新建（按 TopBar 顺序：新建/打开/保存/运行）
  const btnInfo = await ev(`JSON.stringify([...document.querySelectorAll('.topbar button')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), disabled: b.disabled, pe: getComputedStyle(b).pointerEvents }; }))`);
  console.log('buttons: ' + btnInfo);
  const btns = JSON.parse(btnInfo);
  for (const b of btns) {
    console.log(`click "${b.t}" @(${b.x},${b.y}) disabled=${b.disabled} pe=${b.pe}`);
    await mouse('mousePressed', b.x, b.y);
    await mouse('mouseReleased', b.x, b.y);
    await sleep(400);
    const st = await ev(`JSON.stringify({ modalOpen: !!document.querySelector('.modal-mask'), nodeCount: window.__comfyGraph ? Object.keys(window.__comfyGraph.graph._nodes).length : -1 })`);
    console.log('  -> ' + st);
  }

  console.log('=== 4. 画布右键（真实 mousePressed right） ===');
  const hostBox = await ev(`JSON.stringify((() => { const r = document.querySelector('.canvas-host').getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`);
  const hb = JSON.parse(hostBox);
  await mouse('mousePressed', hb.x, hb.y, 'right', 2);
  await mouse('mouseReleased', hb.x, hb.y, 'right', 2);
  await sleep(600);
  console.log('searchBox: ' + await ev(`JSON.stringify({ shown: !!document.querySelector('.node-search-box'), input: !!document.querySelector('.nsb-input') })`));

  console.log('=== 5. 真实键盘输入搜索词 ===');
  if (await ev(`!!document.querySelector('.nsb-input')`)) {
    for (const ch of 'TextInput') {
      await key(ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0));
    }
    await sleep(500);
    console.log('rows: ' + await ev(`JSON.stringify({ count: document.querySelectorAll('.nsb-row').length, first: (document.querySelector('.nsb-row .nm')||{}).textContent })`));
    await key('Enter', 'Enter', 13);
    await sleep(700);
    console.log('afterEnter nodes: ' + await ev(`Object.keys(window.__comfyGraph.graph._nodes).length`));
  }

  console.log('=== 6. canvas 提取 ===');
  const durl = await ev(`window.__comfyGraph ? window.__comfyGraph.canvas.canvas.toDataURL('image/png') : 'NO_GRAPH'`);
  if (durl && durl.startsWith('data:')) {
    fs.writeFileSync(path.join(shotDir, '50-repro-canvas.png'), Buffer.from(durl.split(',')[1], 'base64'));
    console.log('[shot] 50-repro-canvas.png (from canvas.toDataURL)');
  }
  await shot('51-repro-page.png');

  console.log('=== 7. 最终 console 全量 ===');
  console.log(await ev('JSON.stringify(window.__logs)'));
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
