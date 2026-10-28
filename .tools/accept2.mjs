/**
 * 交付前严格验收：真实鼠标 + 真实键盘（Input.insertText），
 * 完整走一遍用户的操作路径：新建 → 右键建节点 → 拖线自动连线 → 保存 → 打开还原 → 运行
 * 用法: node .tools/accept2.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'accept2-' + crypto.randomBytes(4).toString('hex'));
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
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' 超时')); } }, 60000);
  });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); }
}

async function main() {
  const t = await targets();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result);
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__logs = [];
      for (const lvl of ['warn','error']) {
        const orig = console[lvl];
        console[lvl] = function(...a) {
          window.__logs.push(lvl + ': ' + a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '?' } }).join(' ').slice(0, 260));
          orig.apply(console, a);
        };
      }
      window.addEventListener('error', e => window.__logs.push('error: ' + e.message));
      window.addEventListener('unhandledrejection', e => window.__logs.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
    `
  });

  await send('Page.navigate', { url: 'http://localhost:5173' });
  await sleep(9000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: (type === 'mousePressed' || type === 'mouseReleased') ? 1 : 0 });
    await sleep(100);
  };
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const rightClick = async (x, y) => { await mouse('mousePressed', x, y, 'right', 2); await mouse('mouseReleased', x, y, 'right', 2); };
  const typeText = async (txt) => { await send('Input.insertText', { text: txt }); await sleep(400); };
  const pressEnter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(700);
  };
  const btnCenter = async (label) => JSON.parse(await ev(`JSON.stringify((() => { const b = [...document.querySelectorAll('.topbar button')].find(x => x.textContent.trim().includes(${JSON.stringify(label)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`));
  const nodeCount = async () => await ev(`window.__comfyGraph ? Object.keys(window.__comfyGraph.graph._nodes).length : -1`);
  const linkCount = async () => await ev(`JSON.stringify(Object.keys(window.__comfyGraph.graph.links || {}).length)`);

  console.log('\n=== 0. 页面骨架 ===');
  const skel = JSON.parse(await ev(`JSON.stringify({ shell: !!document.querySelector('.app-shell'), topbar: document.querySelectorAll('.topbar button').length, host: !!document.querySelector('.canvas-host'), graph: !!window.__comfyGraph })`));
  check('页面外壳渲染', skel.shell);
  check('顶栏按钮 8 个', skel.topbar === 8, '实际 ' + skel.topbar);
  check('画布容器存在', skel.host);
  check('画布引擎已初始化', skel.graph);

  console.log('\n=== 1. 新建（清空画布） ===');
  await click(...Object.values(await btnCenter('新建')));
  await sleep(600);
  check('新建后节点数为 0', (await nodeCount()) === 0);
  check('空画布新手引导可见', await ev(`!!document.querySelector('.empty-guide')`));

  console.log('\n=== 2. 右键画布 → 搜索 → 键盘输入 → 回车建节点 ===');
  const hb = JSON.parse(await ev(`JSON.stringify((() => { const r = document.querySelector('.canvas-host').getBoundingClientRect(); return { cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2), left: Math.round(r.x), top: Math.round(r.y) }; })())`));
  await rightClick(hb.cx - 200, hb.cy - 100);
  await sleep(600);
  const boxShown = await ev(`!!document.querySelector('.node-search-box')`);
  check('右键弹出搜索浮层', boxShown);
  if (boxShown) {
    await ev(`document.querySelector('.nsb-input').focus()`);
    await typeText('TextInput');
    const rows = JSON.parse(await ev(`JSON.stringify({ n: document.querySelectorAll('.nsb-row').length, first: (document.querySelector('.nsb-row .nm') || {}).textContent || '' })`));
    check('键盘输入实时过滤', rows.n > 0 && rows.n < 20, `${rows.n} 行，首行「${rows.first}」`);
    check('搜索命中文本输入节点', /Text Input|TextInput|文本输入/i.test(rows.first), rows.first);
    await pressEnter();
    const n1 = await nodeCount();
    const types1 = await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n => n.type))`);
    check('回车成功创建节点', n1 === 1, `节点=${n1} ${types1}`);
    check('创建的正是 TextInput', /TextInput/.test(types1), types1);
    check('有节点后新手引导消失', !(await ev(`!!document.querySelector('.empty-guide')`)));
  }

  console.log('\n=== 3. 再右键建 TextDisplay ===');
  await rightClick(hb.cx + 200, hb.cy + 60);
  await sleep(500);
  if (await ev(`!!document.querySelector('.node-search-box')`)) {
    await ev(`document.querySelector('.nsb-input').focus()`);
    await typeText('Text Display');
    await pressEnter();
  }
  const n2 = await nodeCount();
  check('第二个节点创建成功', n2 === 2, '节点=' + n2 + ' ' + await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n => n.type))`));

  console.log('\n=== 4. 从输出端口拖到空白 → 过滤搜索 → 回车自动连线 ===');
  // 先把视图重置到可见
  await ev(`window.__comfyGraph.fitView()`);
  await sleep(400);
  // 找 TextInput 的输出端口屏幕坐标 + 一个空白落点
  const drag = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const n = Object.values(g.graph._nodes).find(x => x.type === 'TextInput');
    if (!n) return { err: 'no TextInput' };
    const [gx, gy] = n.getConnectionPos(false, 0);
    const r = g.canvas.canvas.getBoundingClientRect();
    const va = g.canvas.visible_area;
    const sx = Math.round(r.left + (gx - va[0]) * g.canvas.ds.scale);
    const sy = Math.round(r.top + (gy - va[1]) * g.canvas.ds.scale);
    return { sx, sy, tx: Math.round(r.right - 180), ty: Math.round(r.bottom - 140) };
  })())`));
  if (!drag.err) {
    await mouse('mouseMoved', drag.sx, drag.sy, 'none', 0);
    await mouse('mousePressed', drag.sx, drag.sy);
    await mouse('mouseMoved', drag.tx, drag.ty, 'left', 1);
    await mouse('mouseReleased', drag.tx, drag.ty, 'left', 0);
    await sleep(800);
    const filtered = JSON.parse(await ev(`JSON.stringify({ shown: !!document.querySelector('.node-search-box'), filter: (document.querySelector('.nsb-filter') || {}).textContent || '', rows: document.querySelectorAll('.nsb-row').length })`));
    check('拖线到空白弹搜索', filtered.shown, filtered.filter);
    check('搜索带端口类型过滤标签', /STRING/.test(filtered.filter), filtered.filter);
    const before = (await linkCount());
    if (filtered.shown) {
      await ev(`document.querySelector('.nsb-input').focus()`);
      await typeText('Text Display');
      await pressEnter();
    }
    const after = (await linkCount());
    check('选中后自动连线', Number(after) > Number(before), `links ${before} → ${after}`);
  }

  console.log('\n=== 5. 保存 ===');
  await ev(`(() => { const i = document.querySelector('.wf-name'); if (i) { i.value = '验收-生产模式'; i.dispatchEvent(new Event('input')); } })()`);
  await click(...Object.values(await btnCenter('保存')));
  await sleep(1600);
  const hintText = await ev(`(document.querySelector('.app-hint') || {}).textContent || ''`);
  check('保存有明确反馈', /已保存/.test(hintText), hintText);

  console.log('\n=== 6. 打开列表 → 找到刚保存的 ===');
  await click(...Object.values(await btnCenter('打开')));
  await sleep(900);
  const listInfo = JSON.parse(await ev(`JSON.stringify({ modal: !!document.querySelector('.modal-mask'), items: [...document.querySelectorAll('.modal .node-item')].map(e => e.textContent.trim()).slice(0, 12), examples: [...document.querySelectorAll('.modal .node-item')].filter(e => /①|②|③|④/.test(e.textContent)).length })`));
  check('打开对话框弹出', listInfo.modal);
  check('示例工作流 4 条在列表', listInfo.examples >= 4, '示例 ' + listInfo.examples + ' 条');
  check('刚保存的工作流在列表', listInfo.items.some(x => x.includes('验收-生产模式')), listInfo.items.filter(x => x.includes('验收')).join(' | '));

  console.log('\n=== 7. 加载示例④ 并真实运行 ===');
  await ev(`(() => { const it = [...document.querySelectorAll('.modal .node-item')].find(e => e.textContent.includes('④')); if (it) it.click(); })()`);
  await sleep(2000);
  const exNodes = await nodeCount();
  check('示例④ 加载出 7 节点', exNodes === 7, '节点=' + exNodes);
  await click(...Object.values(await btnCenter('运行')));
  await sleep(6000);
  const runState = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const nodes = Object.values(g.graph._nodes);
    const td = nodes.find(n => n.type === 'TextDisplay');
    const pv = nodes.find(n => n.type === 'PreviewImageNative');
    const tdEl = td && td.widgets && td.widgets[td.widgets.length - 1] && td.widgets[td.widgets.length - 1].element;
    const pvEl = pv && pv.widgets && pv.widgets[pv.widgets.length - 1] && pv.widgets[pv.widgets.length - 1].element;
    const img = pvEl ? pvEl.querySelector('img') : null;
    return {
      text: tdEl ? (tdEl.textContent || '').trim().slice(0, 40) : '(无)',
      imgW: img ? img.naturalWidth : 0,
      imgVisible: img ? img.style.display !== 'none' : false,
      execStatus: (document.querySelector('.executing-toast') ? 'running' : 'idle')
    };
  })())`));
  check('文本链执行结果回显', runState.text.length > 0 && runState.text !== '(无)', runState.text);
  check('图片预览真实加载', runState.imgW > 0 && runState.imgVisible, `naturalWidth=${runState.imgW}`);

  console.log('\n=== 8. console 检查（Vue 警告应已消失） ===');
  const logs = JSON.parse(await ev(`JSON.stringify(window.__logs)`));
  const vueWarns = logs.filter(x => /Vue warn/.test(x));
  const errs = logs.filter(x => /^(error|rejection):/.test(x));
  check('无 Vue 警告', vueWarns.length === 0, vueWarns.slice(0, 2).join(' || '));
  check('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' || '));

  console.log('\n=== 9. 导出画布真实像素 ===');
  const durl = await ev(`window.__comfyGraph.canvas.canvas.toDataURL('image/png')`);
  if (durl && durl.startsWith('data:')) {
    fs.writeFileSync(path.join(shotDir, '60-accept2-canvas.png'), Buffer.from(durl.split(',')[1], 'base64'));
    console.log('  [canvas] .shots/60-accept2-canvas.png');
  }
  const r2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, '61-accept2-page.png'), Buffer.from(r2.data, 'base64'));
  console.log('  [page]   .shots/61-accept2-page.png');

  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
}

main()
  .catch(e => { console.error('ERROR: ' + e.message); })
  .finally(async () => {
    try { ws && ws.close(); } catch { /* ignore */ }
    await sleep(200);
    try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
    await sleep(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(fail > 0 ? 1 : 0);
  });
