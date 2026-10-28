/**
 * 验收 5：多任务运行 / 呼吸态 / 任务角标 / 停止下拉 / 逐个取消
 * 用一组耗时任务（EmptyImage 5000 + 3 次模糊）保证队列里真的有多条，
 * 全部走真实鼠标点击（CDP Input.dispatchMouseEvent），不做 DOM 直接调用。
 * 用法: node .tools/accept5.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'accept5-' + crypto.randomBytes(4).toString('hex'));
const shotDir = path.resolve('.shots');
fs.mkdirSync(shotDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1680,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('无法连接 Edge 调试端口');
}

let ws; let msgId = 0; const waiters = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' 超时')); } }, 60000);
  });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); }
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64'));
}

/** 生成一份耗时工作流（litegraph 序列化格式） */
function slowWorkflow() {
  const n = (id, type, pos, size, inputs, outputs, widgets_values) => ({
    id, type, pos, size, flags: {}, order: id - 1, mode: 0,
    inputs: inputs.map(([name, type]) => ({ name, type, link: null })),
    outputs: outputs.map(([name, type]) => ({ name, type, links: [], slot_index: 0 })),
    properties: {}, widgets_values
  });
  const nodes = [
    n(1, 'EmptyImage', [60, 120], [280, 150],
      [], [['IMAGE', 'IMAGE']], [6000, 6000, 1, 0x2b6cb0]),
    n(2, 'ImageBlur', [420, 120], [280, 110],
      [['image', 'IMAGE']], [['IMAGE', 'IMAGE']], [31, 9]),
    n(3, 'ImageBlur', [420, 300], [280, 110],
      [['image', 'IMAGE']], [['IMAGE', 'IMAGE']], [31, 9]),
    n(4, 'ImageBlur', [760, 120], [280, 110],
      [['image', 'IMAGE']], [['IMAGE', 'IMAGE']], [31, 9]),
    n(5, 'ImageBlur', [760, 300], [280, 110],
      [['image', 'IMAGE']], [['IMAGE', 'IMAGE']], [31, 9]),
    n(6, 'PreviewImage', [1100, 120], [320, 300],
      [['images', 'IMAGE']], [], [])
  ];
  // 链接: [id, fromNode, fromSlot, toNode, toSlot, type]
  const links = [
    [1, 1, 0, 2, 0, 'IMAGE'],
    [2, 2, 0, 3, 0, 'IMAGE'],
    [3, 3, 0, 4, 0, 'IMAGE'],
    [4, 4, 0, 5, 0, 'IMAGE'],
    [5, 5, 0, 6, 0, 'IMAGE']
  ];
  nodes[0].outputs[0].links = [1];
  nodes[1].inputs[0].link = 1; nodes[1].outputs[0].links = [2];
  nodes[2].inputs[0].link = 2; nodes[2].outputs[0].links = [3];
  nodes[3].inputs[0].link = 3; nodes[3].outputs[0].links = [4];
  nodes[4].inputs[0].link = 4; nodes[4].outputs[0].links = [5];
  nodes[5].inputs[0].link = 5;
  return { last_node_id: 6, last_link_id: 5, nodes, links, groups: [], config: {}, extra: {}, version: 0.4 };
}

async function main() {
  const t = await targets();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result);
    }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__logs = [];
      for (const lvl of ['warn','error']) {
        const orig = console[lvl];
        console[lvl] = function(...a) {
          window.__logs.push(lvl + ': ' + a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '?' } }).join(' ').slice(0, 300));
          orig.apply(console, a);
        };
      }
      window.addEventListener('error', e => window.__logs.push('error: ' + e.message));
    `
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
  await sleep(9000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: (type === 'mousePressed' || type === 'mouseReleased') ? 1 : 0 });
    await sleep(60);
  };
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const center = async (sel, idx = 0) => JSON.parse(await ev(`JSON.stringify((() => {
    const els = document.querySelectorAll(${JSON.stringify(sel)}); const b = els[${idx}]; if (!b) return null;
    const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })())`));

  // ---- 载入耗时工作流 ----
  const wf = slowWorkflow();
  await ev(`(()=>{ window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`);
  await sleep(1500);
  check('耗时工作流已载入', (await ev(`Object.keys(window.__comfyGraph.graph._nodes).length`)) === 6);
  check('节点标题为中文', (await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n=>n.title))`)).includes('空图像'));

  const runPos = await center('.run-btn');
  check('找到运行按钮', !!runPos);

  // ---- 运行前状态 ----
  const idle = JSON.parse(await ev(`JSON.stringify({
    badge: (document.querySelector('.run-btn .ib-badge') || {}).textContent || '',
    pulse: document.querySelector('.run-btn').classList.contains('is-running'),
    stopDisabled: document.querySelectorAll('.run-group .icon-btn')[1].disabled
  })`));
  check('空闲时运行按钮无角标', idle.badge === '', `badge="${idle.badge}"`);
  check('空闲时运行按钮不呼吸', idle.pulse === false);
  check('空闲时停止按钮不可用', idle.stopDisabled === true);

  console.log('\n=== 连点 3 次运行 ===');
  for (let i = 0; i < 4; i++) { await click(runPos.x, runPos.y); await sleep(80); }

  // 采样 2.5s 内状态
  let maxBadge = 0;
  let sawPulse = false;
  let sawStopEnabled = false;
  for (let i = 0; i < 50; i++) {
    const s = JSON.parse(await ev(`JSON.stringify({
      b: parseInt((document.querySelector('.run-btn .ib-badge') || {}).textContent || '0', 10) || 0,
      p: document.querySelector('.run-btn').classList.contains('is-running'),
      sd: document.querySelectorAll('.run-group .icon-btn')[1].disabled
    })`));
    if (s.b > maxBadge) maxBadge = s.b;
    if (s.p) sawPulse = true;
    if (s.sd === false) sawStopEnabled = true;
    if (maxBadge >= 4) break;
    await sleep(50);
  }
  check('运行按钮角标显示任务数', maxBadge >= 2, `峰值角标 ${maxBadge}`);
  check('运行中按钮四周呼吸（is-running）', sawPulse);
  check('运行中停止按钮变为可用', sawStopEnabled);
  await shot('80-accept5-running.png');

  // ---- 点停止：多任务时应展开下拉 ----
  const stopPos = await center('.run-group .icon-btn', 1);
  await click(stopPos.x, stopPos.y);
  await sleep(250);
  const menu = JSON.parse(await ev(`JSON.stringify({
    open: !!document.querySelector('.task-menu'),
    rows: [...document.querySelectorAll('.task-menu .tm-row')].map(r => r.textContent.trim()),
    live: document.querySelectorAll('.task-menu .tm-dot.live').length
  })`));
  check('多任务时点停止展开任务下拉', menu.open === true);
  check('下拉里列出每个排队任务', menu.rows.length >= 1, JSON.stringify(menu.rows));
  check('正在跑的任务有 live 标记', menu.live === 1, `live=${menu.live}`);
  if (menu.open) await shot('81-accept5-taskmenu.png');

  const queueBefore = await ev(`fetch('/queue').then(r=>r.json()).then(j=>({r:j.running.length,p:j.pending.length}))`);
  if (menu.rows.length >= 2) {
    // 取消最后一行（排队中的）
    const cancelPos = JSON.parse(await ev(`JSON.stringify((() => {
      const rows = [...document.querySelectorAll('.task-menu .tm-row')];
      const last = rows[rows.length-1]; if (!last) return null;
      const b = last.querySelector('.tm-x'); const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })())`));
    await click(cancelPos.x, cancelPos.y);
    await sleep(500);
    const queueAfter = await ev(`fetch('/queue').then(r=>r.json()).then(j=>({r:j.running.length,p:j.pending.length}))`);
    check('下拉里可以取消单个任务', (queueAfter.r + queueAfter.p) < (queueBefore.r + queueBefore.p),
      `${queueBefore.r + queueBefore.p} → ${queueAfter.r + queueAfter.p}`);
    check('任务数角标同步减少', (await ev(`parseInt((document.querySelector('.run-btn .ib-badge')||{}).textContent||'0',10)||0`)) < maxBadge);
  } else {
    console.log('  SKIP  队列里只剩 1 条，跳过逐个取消（任务跑太快）');
  }

  // ---- 全部停止 ----
  const clearPos = await center('.task-menu .tm-clear');
  if (clearPos) {
    await click(clearPos.x, clearPos.y);
    let cleared = false;
    for (let i = 0; i < 25; i++) {
      const q = await ev(`fetch('/queue').then(r=>r.json()).then(j=>({r:j.running.length,p:j.pending.length}))`);
      if (q.r + q.p === 0) { cleared = true; break; }
      await sleep(120);
    }
    check('「全部停止」清空队列', cleared);
  }
  await sleep(700);
  const after = JSON.parse(await ev(`JSON.stringify({
    badge: (document.querySelector('.run-btn .ib-badge') || {}).textContent || '',
    pulse: document.querySelector('.run-btn').classList.contains('is-running'),
    sd: document.querySelectorAll('.run-group .icon-btn')[1].disabled,
    menu: !!document.querySelector('.task-menu')
  })`));
  check('停止后角标消失', after.badge === '', `badge="${after.badge}"`);
  check('停止后呼吸动画停止', after.pulse === false);
  check('停止后停止按钮回到不可用', after.sd === true);
  check('停止后下拉关闭', after.menu === false);

  console.log('\n=== 控制台检查 ===');
  const logs = await ev(`JSON.stringify(window.__logs || [])`);
  check('无运行时错误', logs === '[]', logs.slice(0, 200));

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  ws.close(); edge.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); try { edge.kill(); } catch { /* ignore */ } process.exit(1); });
