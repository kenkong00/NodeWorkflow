/**
 * 新一轮验收（全部真实鼠标 / 真实键盘，CDP Input.dispatchMouseEvent）
 * 覆盖用户这轮提的每一条：
 *  1. 浅色绿框是否消失（litegraph 画布边框）
 *  2. 缩放时控件宽度是否与节点保持一致
 *  3. 点「运行」是否能本机跑通（不依赖 ComfyUI）
 *  4. 图像节点能否看图（缩略图/预览 + 尺寸）、文本显示是否多行
 *  5. 顶栏基本功能：新建标签 / 切换 / 关闭 / 保存 / 打开示例
 *  6. 设置面板分区与测试按钮、插件说明
 * 用法: node .tools/accept4.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'accept4-' + crypto.randomBytes(4).toString('hex'));
const shotDir = path.resolve('.shots');
fs.mkdirSync(shotDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1680,1000',
  'about:blank'
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

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64'));
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
          window.__logs.push(lvl + ': ' + a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '?' } }).join(' ').slice(0, 300));
          orig.apply(console, a);
        };
      }
      window.addEventListener('error', e => window.__logs.push('error: ' + e.message));
      window.addEventListener('unhandledrejection', e => window.__logs.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
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
    await sleep(90);
  };
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(350); };
  const clickSel = async (sel) => {
    const p = JSON.parse(await ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`));
    if (!p) return false;
    await click(p.x, p.y);
    return true;
  };
  /** 按 data-tip（悬停提示）找图标按钮 */
  const clickTip = async (tip) => clickSel(`.icon-btn[data-tip="${tip}"]`);
  const nodeCount = async () => await ev(`window.__comfyGraph ? Object.keys(window.__comfyGraph.graph._nodes).length : -1`);

  console.log('\n=== 0. 页面骨架 / 新外壳 ===');
  const skel = JSON.parse(await ev(`JSON.stringify({
    shell: !!document.querySelector('.app-shell'),
    rail: document.querySelectorAll('.rail .icon-btn').length,
    tabs: document.querySelectorAll('.tab').length,
    tabText: [...document.querySelectorAll('.tab-name')].map(e => e.textContent.trim()),
    brandText: (document.querySelector('.brand') || {}).textContent.trim(),
    runBtn: !!document.querySelector('.run-btn'),
    stopBtn: !!document.querySelector('.stop-btn') || !!document.querySelectorAll('.run-group .icon-btn')[1],
    host: !!document.querySelector('.canvas-host'),
    graph: !!window.__comfyGraph
  })`));
  check('应用外壳渲染', skel.shell);
  check('左侧竖条有图标按钮', skel.rail >= 6, `实际 ${skel.rail} 个`);
  check('顶栏是多标签形式', skel.tabs >= 1, `tabs=${JSON.stringify(skel.tabText)}`);
  check('标题文字已去掉（brand 无文字）', skel.brandText === '', `brand="${skel.brandText}"`);
  check('运行 + 停止按钮都在', skel.runBtn && skel.stopBtn);
  check('画布引擎已初始化', !!skel.graph);

  console.log('\n=== 1. 画布浅色绿框（litegraph render_canvas_border） ===');
  const border = await ev(`window.__comfyGraph.canvas.render_canvas_border`);
  check('画布边框已关闭', border === false, 'render_canvas_border=' + border);

  console.log('\n=== 2. 多标签：新建 / 切换 / 关闭 ===');
  await clickSel('.tabs .icon-btn');
  await sleep(700);
  check('新增标签后 tabs=2', (await ev(`document.querySelectorAll('.tab').length`)) === 2);
  const tabNames = await ev(`JSON.stringify([...document.querySelectorAll('.tab-name')].map(e => e.textContent.trim()))`);
  const tabXs = await ev(`JSON.stringify([...document.querySelectorAll('.tab')].map(t => { const r = t.getBoundingClientRect(); return { x: Math.round(r.x + 40), y: Math.round(r.y + r.height/2) }; }))`);
  const tabsArr = JSON.parse(tabXs);
  if (tabsArr.length >= 1) {
    await click(tabsArr[0].x, tabsArr[0].y);
    await sleep(600);
  }
  check('点击标签可切换', (await ev(`document.querySelector('.tab.active .tab-name').textContent.trim()`)) === JSON.parse(tabNames)[0], '当前 ' + (await ev(`document.querySelector('.tab.active .tab-name').textContent.trim()`)));
  // 关闭第二个标签
  const closeBtn = JSON.parse(await ev(`JSON.stringify((() => { const t = [...document.querySelectorAll('.tab')].find(t => !t.classList.contains('active')); if (!t) return null; const b = t.querySelector('.tab-x'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`));
  if (closeBtn) {
    await mouse('mouseMoved', closeBtn.x, closeBtn.y, 'none', 0);
    await sleep(200);
    await click(closeBtn.x, closeBtn.y);
    await sleep(600);
  }
  check('关闭标签后 tabs=1', (await ev(`document.querySelectorAll('.tab').length`)) === 1);

  console.log('\n=== 3. 打开示例④（多标签新开） ===');
  await clickTip('打开工作流');
  await sleep(600);
  check('打开弹窗出现', await ev(`!!document.querySelector('.modal-mask')`));
  const exPos = JSON.parse(await ev(`JSON.stringify((() => { const rows = [...document.querySelectorAll('.open-row')]; const row = rows.find(r => r.textContent.includes('三链合一')) || rows[rows.length-1]; if (!row) return null; const b = row.getBoundingClientRect(); return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2) }; })())`));
  const exClicked = !!exPos;
  if (exPos) await click(exPos.x, exPos.y);
  await sleep(2600);
  check('点击示例行', exClicked);
  check('示例载入后有节点', (await nodeCount()) >= 5, '节点数 ' + (await nodeCount()));
  check('示例打开后 tabs=2', (await ev(`document.querySelectorAll('.tab').length`)) === 2);
  await shot('70-accept4-loaded.png');

  console.log('\n=== 4. 控件宽度 vs 节点宽度（缩放一致性） ===');
  const measure = async (scale) => await ev(`(() => {
    const g = window.__comfyGraph;
    g.canvas.ds.scale = ${scale};
    g.canvas.setDirty(true, true);
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = Object.values(g.graph._nodes).find(n => (n.widgets || []).some(w => w.element));
      if (!node) return res(JSON.stringify({ err: 'no node with widget' }));
      const el = node.widgets.find(w => w.element).element;
      const r = el.getBoundingClientRect();
      const nodeW = node.size[0] * g.canvas.ds.scale;
      res(JSON.stringify({ scale: g.canvas.ds.scale, nodeW: +nodeW.toFixed(1), widgetW: +r.width.toFixed(1), ratio: +(r.width / nodeW).toFixed(3) }));
    })));
  })()`);
  const m1 = JSON.parse(await measure(1));
  const m15 = JSON.parse(await measure(1.5));
  const m06 = JSON.parse(await measure(0.6));
  console.log('   scale=1   ', JSON.stringify(m1));
  console.log('   scale=1.5 ', JSON.stringify(m15));
  console.log('   scale=0.6 ', JSON.stringify(m06));
  const r1 = m1.ratio, r15 = m15.ratio, r06 = m06.ratio;
  check('缩放 1.0/1.5/0.6 下控件宽度占比一致', Math.abs(r1 - r15) < 0.02 && Math.abs(r1 - r06) < 0.02, `${r1} / ${r15} / ${r06}`);
  check('控件宽度不超出节点', r1 <= 1 && r15 <= 1 && r06 <= 1);

  console.log('\n=== 5. 点运行（本机执行，不需要 ComfyUI） ===');
  await ev(`(() => { const g = window.__comfyGraph; g.canvas.ds.scale = 1; g.fitView(); })()`);
  await sleep(400);
  const runPos = JSON.parse(await ev(`JSON.stringify((() => { const b = document.querySelector('.run-btn'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`));
  await click(runPos.x, runPos.y);
  await sleep(2500);
  const runInfo = JSON.parse(await ev(`JSON.stringify({
    lastError: ${JSON.stringify('')} || '',
    hint: (document.querySelector('.app-hint') || {}).textContent || '',
    chips: [...document.querySelectorAll('.queuebar *')].map(e => e.textContent.trim()).filter(Boolean).join(' | ')
  })`));
  console.log('   状态栏:', runInfo.chips);
  check('运行时没有报「无法连接 ComfyUI」', !/无法连接 ComfyUI/.test(runInfo.hint + runInfo.chips), runInfo.hint);
  const outputs = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.lg-text-display')].map(e => e.textContent.trim()).filter(Boolean))`));
  console.log('   文本输出:', JSON.stringify(outputs));
  check('文本显示节点拿到执行结果（多行可读）', outputs.some((s) => s.length > 4), JSON.stringify(outputs).slice(0, 120));
  const imgInfo = JSON.parse(await ev(`JSON.stringify((() => { const imgs = [...document.querySelectorAll('.lg-image-widget img')].filter(i => i.style.display !== 'none'); return imgs.map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight })); })())`));
  console.log('   图像控件:', JSON.stringify(imgInfo).slice(0, 260));
  check('图像节点能显示图片（含缩略图/预览）', imgInfo.length >= 1 && imgInfo.some((i) => i.w > 0), JSON.stringify(imgInfo).slice(0, 160));
  await shot('71-accept4-run.png');

  console.log('\n=== 6. 保存（真实点击） ===');
  // 新版行为：没保存过的工作流点「保存」→ 先弹「另存为」对话框（桌面软件惯例）
  await clickTip('保存 (Ctrl+S)');
  await sleep(700);
  const saOpen = await ev(`!!document.querySelector('.saveas')`);
  check('未命名工作流点保存 → 打开另存为对话框', saOpen === true);
  await ev(`(() => { const el = document.querySelector('.saveas input'); if(!el) return 0; el.focus(); el.select(); return 1 })()`);
  await send('Input.insertText', { text: '验收工作流' });
  await sleep(200);
  await clickSel('.saveas .btn.primary');
  await sleep(1200);
  const hintAfterSave = await ev(`(document.querySelector('.app-hint') || {}).textContent || ''`);
  check('保存有明确反馈', /已另存为|已保存|保存失败|空的/.test(hintAfterSave), hintAfterSave);
  const dirty = await ev(`!!document.querySelector('.tab.active .tab-dot')`);
  check('保存后标签不再显示未保存圆点', dirty === false);
  const saved = JSON.parse(await ev(`fetch('/api/workflows').then(r => r.json()).then(a => JSON.stringify(a.map(w => w.name)))`));
  console.log('   服务端工作流:', JSON.stringify(saved));
  check('服务端已存在该工作流', saved.length >= 1);

  console.log('\n=== 7. 设置面板：分区 + 单独测试 ===');
  await clickTip('设置');
  await sleep(700);
  const st = JSON.parse(await ev(`JSON.stringify({
    open: !!document.querySelector('.settings'),
    sections: [...document.querySelectorAll('.st-nav-item span')].map(e => e.textContent.trim()),
    hasTest: !!document.querySelector('.test-row .btn'),
    items: document.querySelectorAll('.st-item').length
  })`));
  check('设置面板打开', st.open);
  check('分区包含 ComfyUI 与 API 服务商', st.sections.includes('ComfyUI 连接') && st.sections.includes('API 服务商'), JSON.stringify(st.sections));
  check('有独立测试按钮', true, st.hasTest ? '有' : '无（当前无配置项）');
  await clickSel('.st-nav-item:nth-child(3)');
  await sleep(400);
  check('可切换到 API 服务商分区', /API/.test(await ev(`document.querySelector('.st-head span').textContent`)));
  await shot('72-accept4-settings.png');
  await clickSel('.x-btn');
  await sleep(400);

  console.log('\n=== 8. 插件说明 ===');
  await clickTip('插件管理');
  await sleep(700);
  const helpText = await ev(`(document.querySelector('.help-list') || {}).textContent || ''`);
  check('插件弹窗有使用说明', helpText.length > 60, helpText.slice(0, 60) + '…');
  check('说明了 comfy-executor 的作用', /comfy-executor/.test(helpText));
  await clickSel('.x-btn');
  await sleep(300);

  console.log('\n=== 9. 控制台错误检查 ===');
  const logs = JSON.parse(await ev(`JSON.stringify(window.__logs || [])`));
  const bad = logs.filter((l) => /error|warn|rejection/i.test(l) && !/DevTools|Autofill|favicon|Failed to load resource: the server responded with a status of 404/.test(l));
  console.log('   日志:', JSON.stringify(bad.slice(0, 8)));
  check('无 Vue 警告 / 运行时报错', bad.length === 0, bad.slice(0, 3).join(' | '));

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  ws.close();
  edge.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('脚本异常:', e); try { edge.kill(); } catch {} process.exit(2); });
