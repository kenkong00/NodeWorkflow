/**
 * 验收 6：本轮 UI/交互改造
 *  - 去掉空画布说明浮层 / 网格可见性
 *  - 右键节点菜单（重命名 / 颜色 / 忽略 / 删除）
 *  - 组件隐藏输入端口连线（拖线落在组件行）
 *  - 图片控件随节点拉伸等比放大、无黑底
 *  - 缩放手柄命中区放大 + 最小尺寸
 *  - 节点库拖入：视图不移动、落点即位置
 *  - 标签双击重命名 / 另存为对话框
 *  - API 服务商节点实时显示已配置服务商
 * 用法: node .tools/accept6.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const profile = path.join(os.tmpdir(), 'accept6-' + crypto.randomBytes(4).toString('hex'));
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
    await sleep(50);
  };
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const rclick = async (x, y) => {
    await mouse('mouseMoved', x, y, 'none', 0);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    await sleep(200);
  };
  const drag = async (x1, y1, x2, y2, steps = 12) => {
    await mouse('mouseMoved', x1, y1, 'none', 0);
    await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
    }
    await mouse('mouseReleased', x2, y2);
    await sleep(150);
  };
  const center = async (sel, idx = 0) => JSON.parse(await ev(`JSON.stringify((() => {
    const els = document.querySelectorAll(${JSON.stringify(sel)}); const b = els[${idx}]; if (!b) return null;
    const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })())`));
  /** 节点在图上的矩形 → 屏幕坐标 */
  const nodeRect = async (id) => JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph; const n = g.graph.getNodeById(${id}); if(!n) return null;
    const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset;
    const r = c.canvas.getBoundingClientRect();
    return { x: r.left + (n.pos[0]+o[0])*s, y: r.top + (n.pos[1]+o[1])*s, w: n.size[0]*s, h: n.size[1]*s, scale: s };
  })())`));

  // ============ 1. 空画布 / 网格 ============
  console.log('\n=== 1. 空画布说明与网格 ===');
  check('空画布不再有操作说明浮层', (await ev(`!!document.querySelector('.empty-guide')`)) === false);
  check('画布背景绘制器已挂载', (await ev(`typeof window.__comfyGraph.canvas.onDrawBackground === 'function'`)) === true);
  const gridAlpha = await ev(`(window.__comfyGraph.canvas.onDrawBackground.toString().match(/rgba\\(255,255,255,(0\\.[0-9]+)\\)/) || [])[1] || ''`);
  // 新配色刻意压暗网格（大格 0.035 / 小点 0.075），只要"看得见但不抢戏"即可
  check('网格点亮度可见（0.05 ≤ alpha ≤ 0.20）', parseFloat(gridAlpha || '0') >= 0.05 && parseFloat(gridAlpha || '0') <= 0.2, `alpha=${gridAlpha}`);
  await shot('90-accept6-empty.png');

  // ============ 2. 节点库拖入（视图不位移） ============
  console.log('\n=== 2. 从节点库拖入画布 ===');
  const before = JSON.parse(await ev(`JSON.stringify({ ox: window.__comfyGraph.canvas.ds.offset[0], oy: window.__comfyGraph.canvas.ds.offset[1], s: window.__comfyGraph.canvas.ds.scale })`));
  const dropPos = await ev(`(() => {
    const host = document.querySelector('.canvas-host'); const r = host.getBoundingClientRect();
    const dt = new DataTransfer(); dt.setData('text/comfy-node-type', 'TextInput');
    host.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const drop = { x: Math.round(r.left + 320), y: Math.round(r.top + 240) };
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: drop.x, clientY: drop.y }));
    return drop;
  })()`);
  await sleep(500);
  const after = JSON.parse(await ev(`JSON.stringify({ ox: window.__comfyGraph.canvas.ds.offset[0], oy: window.__comfyGraph.canvas.ds.offset[1], s: window.__comfyGraph.canvas.ds.scale })`));
  check('拖入节点后视图没有位移', before.ox === after.ox && before.oy === after.oy && before.s === after.s, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check('拖入节点后没有留下高亮遮罩', (await ev(`document.querySelector('.canvas-host').classList.contains('drop-active')`)) === false);
  const dropped = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph; const n = Object.values(g.graph._nodes).find(x => x.type === 'TextInput'); if (!n) return null;
    const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
    return { id: n.id, sx: Math.round(r.left + (n.pos[0]+o[0])*s), sy: Math.round(r.top + (n.pos[1]+o[1])*s) };
  })())`));
  check('节点落在鼠标松开的位置', dropped && Math.abs(dropped.sx - dropPos.x) <= 6 && Math.abs(dropped.sy - dropPos.y) <= 6, JSON.stringify({ dropped, dropPos }));

  // ============ 3. 组件对齐 ============
  console.log('\n=== 3. 节点内组件对齐 ===');
  await ev(`(() => {
    const g = window.__comfyGraph; g.graph.clear();
    g.addNode('ImageScale', [120, 120]); g.fitView(); return 1;
  })()`);
  await sleep(900);
  const align = JSON.parse(await ev(`JSON.stringify((() => {
    // 新结构：一行组件 = 胶囊行 .lg-row > (.lg-label + .lg-value > .lg-field)
    // 值本体无边框融进胶囊，所以「右边缘」量 .lg-value（◇ 微调三角外侧的稳定基准），
    // 等高量 .lg-row（22px 统一行高），不再量各控件自身盒高。
    const rows = [...document.querySelectorAll('.lg-dom-widget.lg-row')]
      .filter(r => r.querySelector('.lg-label') && r.querySelector('.lg-field'));
    return rows.map(r => {
      const l = r.querySelector('.lg-label').getBoundingClientRect();
      const v = r.querySelector('.lg-value').getBoundingClientRect();
      const h = r.getBoundingClientRect();
      return { name: r.querySelector('.lg-label').textContent, lx: Math.round(l.left), vr: Math.round(v.right), h: Math.round(h.height) };
    });
  })())`));
  const lxs = [...new Set(align.map((a) => a.lx))];
  const vrs = [...new Set(align.map((a) => a.vr))];
  const hs = [...new Set(align.map((a) => a.h))];
  check('所有控件名称左边缘对齐', lxs.length === 1, JSON.stringify(lxs));
  check('所有控件值右边缘对齐', vrs.length === 1, JSON.stringify(vrs) + ' ' + JSON.stringify(align.map((a) => a.name)));
  check('所有组件行等高', hs.length === 1, JSON.stringify(hs));
  check('控件行数 ≥ 4', align.length >= 4, `rows=${align.length}`);
  await ev(`(() => { const g = window.__comfyGraph; g.fitView(); return 1 })()`);
  await shot('91-accept6-align.png');

  // ============ 4. 右键节点菜单 ============
  console.log('\n=== 4. 右键节点菜单 ===');
  const nid = await ev(`Object.values(window.__comfyGraph.graph._nodes)[0].id`);
  let r = await nodeRect(nid);
  await rclick(r.x + r.w / 2, r.y + 14);
  const menu = JSON.parse(await ev(`JSON.stringify({
    open: !!document.querySelector('.ctx-menu'),
    rows: [...document.querySelectorAll('.ctx-menu .ctx-row')].map(b => b.textContent.trim()),
    swatches: document.querySelectorAll('.ctx-menu .swatch').length
  })`));
  check('右键节点弹出节点菜单（不是画布搜索框）', menu.open === true && !(await ev(`!!document.querySelector('.add-node-search')`)));
  check('菜单含重命名/忽略/删除', menu.rows.some((t) => t.includes('重命名')) && menu.rows.some((t) => t.includes('忽略')) && menu.rows.some((t) => t.includes('删除')), JSON.stringify(menu.rows));
  check('菜单提供固定色板', menu.swatches >= 6, `swatches=${menu.swatches}`);
  await shot('92-accept6-nodemenu.png');

  // 4.1 重命名
  const renameBtn = await center('.ctx-menu .ctx-row', 0);
  await click(renameBtn.x, renameBtn.y);
  await sleep(250);
  check('点重命名出现输入框', (await ev(`!!document.querySelector('.ctx-rename input')`)) === true);
  await ev(`(() => { const el = document.querySelector('.ctx-rename input'); el.focus(); el.select(); el.value = ''; return 1 })()`);
  await send('Input.insertText', { text: '我的改色节点' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(400);
  check('节点标题已更新', (await ev(`[...Object.values(window.__comfyGraph.graph._nodes)].some(n => n.title === '我的改色节点')`)) === true);

  // 4.2 颜色
  r = await nodeRect(nid);
  await rclick(r.x + r.w / 2, r.y + 14);
  const sw = JSON.parse(await ev(`JSON.stringify((() => {
    const b = document.querySelectorAll('.ctx-menu .swatch')[4]; const rr = b.getBoundingClientRect();
    return { x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) };
  })())`));
  await click(sw.x, sw.y);
  await sleep(300);
  const colorNow = await ev(`(window.__comfyGraph.graph.getNodeById(${nid}) || {}).color || ''`);
  check('节点颜色已改变', /^#/.test(colorNow), colorNow);
  await shot('93-accept6-nodecolor.png');

  // 4.3 忽略节点
  r = await nodeRect(nid);
  await rclick(r.x + r.w / 2, r.y + 14);
  const bypassBtn = JSON.parse(await ev(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.ctx-menu .ctx-row')].find(x => x.textContent.includes('忽略'));
    const rr = b.getBoundingClientRect(); return { x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) };
  })())`));
  await click(bypassBtn.x, bypassBtn.y);
  await sleep(400);
  check('节点被标记为忽略（mode=4）', (await ev(`window.__comfyGraph.graph.getNodeById(${nid}).mode`)) === 4);
  check('被忽略节点控件置灰', (await ev(`!!document.querySelector('.lg-dom-widget.is-linked')`)) === true);
  await shot('94-accept6-bypass.png');

  // 4.4 忽略的节点在执行 prompt 里被跳过
  const prompt = JSON.parse(await ev(`JSON.stringify((() => { const p = window.__comfyGraph.toPrompt(); return Object.keys(p); })())`));
  check('toPrompt 跳过被忽略的节点', !prompt.includes(String(nid)), `keys=${JSON.stringify(prompt)}`);

  // ============ 5. 图片控件自适应 ============
  console.log('\n=== 5. 图片控件随节点拉伸 ===');
  const wf = JSON.parse(fs.readFileSync('public/examples/03-图像预览.json', 'utf8'));
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`);
  await sleep(1800);
  const imgNode = await ev(`(() => { const n = Object.values(window.__comfyGraph.graph._nodes).find(x => /LoadImage/.test(x.type)); return n ? n.id : null })()`);
  check('示例里的加载图像节点存在', imgNode != null, `id=${imgNode}`);
  const beforeImg = JSON.parse(await ev(`JSON.stringify((() => {
    const n = window.__comfyGraph.graph.getNodeById(${imgNode});
    const w = (n.widgets || []).find(x => x.type === 'dom-thumb');
    if (!w || !w.element) return null;
    const img = w.element.querySelector('img');
    if (!img) return null;
    return { h: Math.round(img.getBoundingClientRect().height), w: Math.round(img.getBoundingClientRect().width), imgBg: getComputedStyle(img).backgroundColor };
  })())`));
  check('图片没有黑底', beforeImg && beforeImg.imgBg.includes('rgba(0, 0, 0, 0)'), beforeImg && beforeImg.imgBg);
  await ev(`(() => { const n = window.__comfyGraph.graph.getNodeById(${imgNode}); n.setSize([n.size[0], n.size[1] + 260]); window.__comfyGraph.canvas.setDirty(true, true); return 1 })()`);
  await sleep(700);
  const afterImg = JSON.parse(await ev(`JSON.stringify((() => {
    const n = window.__comfyGraph.graph.getNodeById(${imgNode});
    const w = (n.widgets || []).find(x => x.type === 'dom-thumb');
    const img = w && w.element && w.element.querySelector('img');
    return img ? { h: Math.round(img.getBoundingClientRect().height) } : null;
  })())`));
  check('拉高节点后图片跟着变高', afterImg && afterImg.h > beforeImg.h + 100, `${beforeImg.h} → ${afterImg.h}`);
  await ev(`(() => { const n = window.__comfyGraph.graph.getNodeById(${imgNode}); n.setSize([n.size[0] + 180, n.size[1]]); window.__comfyGraph.canvas.setDirty(true, true); return 1 })()`);
  await sleep(600);
  const wider = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph;
    const n = g.graph.getNodeById(${imgNode});
    const w = (n.widgets || []).find(x => x.type === 'dom-thumb');
    const img = w && w.element && w.element.querySelector('img');
    if (!img) return null;
    const s = g.canvas.ds.scale; const o = g.canvas.ds.offset;
    const cr = g.canvas.canvas.getBoundingClientRect();
    const rowR = w.element.getBoundingClientRect();
    const imgR = img.getBoundingClientRect();
    const nodeRight = cr.left + (n.pos[0] + o[0] + n.size[0]) * s;
    return {
      imgW: Math.round(imgR.width),
      rowW: Math.round(rowR.width),
      gap: Math.round((nodeRight - imgR.right) / s), // 换算回图坐标：新布局应为内缩 8px（输出点右缘与组件右缘对齐）
      wy: n.widgets_start_y, // 组件起始 y：应 >= 输出行数×26（输出行独占组件上方的端口行带）
      scale: Math.round(s * 1000) / 1000,
      nodeW: Math.round(n.size[0] * s)
    };
  })())`));
  // 图片宽度只受「组件行内容宽 = 节点宽 - 内缩 8*2」约束
  check('图片贴满组件行宽度（不再是固定小图）', wider && Math.abs(wider.imgW - (wider.rowW - 2)) <= 3, JSON.stringify(wider));
  // 新布局：组件左右对称内缩，右缘 = 节点右缘 - 8（与输出端口点右缘对齐）；
  // 输出名/端口点不再和组件抢同一行，而是独占组件上方的端口行带（LoadImage 2 个输出 → wy >= 52）
  check('组件右缘对称内缩 8px，输出行让位到组件上方', wider && Math.abs(wider.gap - 8) <= 2 && wider.wy >= 52, JSON.stringify(wider));
  await shot('95-accept6-image-flex.png');

  // ============ 6. 缩放手柄 ============
  console.log('\n=== 6. 右下角缩放手柄 ===');
  await ev(`(() => { const g = window.__comfyGraph; g.graph.clear(); const n = g.addNode('TextInput', [140, 160]); g.fitView(); return 1 })()`);
  await sleep(800);
  const rid = await ev(`Object.values(window.__comfyGraph.graph._nodes)[0].id`);
  let rr = await nodeRect(rid);
  const sizeBefore = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(${rid}).size)`));
  // 距右下角 16px（旧版 10px 命中区内、但旧版只有 5px 有效）→ 应该能抓住
  await drag(rr.x + rr.w - 14, rr.y + rr.h - 14, rr.x + rr.w + 120, rr.y + rr.h + 90);
  const sizeAfter = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(${rid}).size)`));
  check('离角 14px 处也能拖动缩放', sizeAfter[0] > sizeBefore[0] + 80 && sizeAfter[1] > sizeBefore[1] + 50, `${JSON.stringify(sizeBefore)} → ${JSON.stringify(sizeAfter)}`);

  rr = await nodeRect(rid);
  await drag(rr.x + rr.w - 16, rr.y + rr.h - 16, rr.x - 400, rr.y - 400, 8);
  const sizeMin = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.graph.getNodeById(${rid}).size)`));
  const minAllow = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.minSizeOf(window.__comfyGraph.graph.getNodeById(${rid})))`));
  check('缩小有下限（不会缩成一条线）', sizeMin[0] >= minAllow[0] && sizeMin[1] >= minAllow[1], `size=${JSON.stringify(sizeMin)} min=${JSON.stringify(minAllow)}`);

  // ============ 7. 组件隐藏输入端口 + 连线 ============
  console.log('\n=== 7. 组件隐藏输入端口（拖线到组件上） ===');
  await ev(`(() => {
    const g = window.__comfyGraph; g.graph.clear();
    g.addNode('PrimitiveInt', [80, 120]);
    g.addNode('ImageScale', [820, 120]);
    g.fitView();
    return 1;
  })()`);
  await sleep(900);
  const ids = JSON.parse(await ev(`JSON.stringify((() => {
    const ns = Object.values(window.__comfyGraph.graph._nodes);
    return { a: ns.find(n => n.type === 'PrimitiveInt').id, b: ns.find(n => n.type === 'ImageScale').id };
  })())`));
  const src = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph; const n = g.graph.getNodeById(${ids.a});
    const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
    const p = n.getConnectionPos(false, 0);
    return { x: r.left + (p[0] + o[0]) * s, y: r.top + (p[1] + o[1]) * s };
  })())`));
  // 目标点直接取「组件 DOM 元素」的屏幕位置（与画布渲染坐标一致，最可靠）
  const targetRow = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph; const n = g.graph.getNodeById(${ids.b});
    const w = (n.widgets || []).find(x => x.name === 'width') || (n.widgets || [])[0];
    if (!w || !w.element) return { hasRows: false };
    const r = w.element.getBoundingClientRect();
    const meta = n.__rows && (n.__rows.find(x => String(x.slot.type) === 'INT') || n.__rows[0]);
    return { hasRows: !!meta, name: meta ? String(meta.slot.type) : '', x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) };
  })())`));
  check('ImageScale 有组件输入行', targetRow.hasRows === true, JSON.stringify(targetRow));
  await drag(src.x, src.y, targetRow.x, targetRow.y, 16);
  const linkOk = await ev(`(() => {
    const n = window.__comfyGraph.graph.getNodeById(${ids.b});
    return n.inputs.map(i => i.link).some(v => v != null);
  })()`);
  check('拖线落在组件行可以连上（隐藏端口）', linkOk === true, `rows=${JSON.stringify(targetRow)}`);
  check('连线后组件置灰', (await ev(`!!document.querySelector('.lg-dom-widget.is-linked')`)) === true);
  await shot('96-accept6-widget-slot.png');

  // ============ 8. API 服务商节点 ============
  console.log('\n=== 8. API 服务商节点 ===');
  const providers = JSON.parse(await ev(`fetch('/api/llm-providers').then(r=>r.json()).then(j=>JSON.stringify(j.map(p=>({n:p.name,on:!!p.enabled}))))`));
  await ev(`(() => { const g = window.__comfyGraph; g.graph.clear(); g.addNode('ApiProvider', [160, 160]); g.fitView(); return 1 })()`);
  await sleep(900);
  const provWidget = JSON.parse(await ev(`JSON.stringify((() => {
    const sel = document.querySelector('.lg-dom-widget select');
    const info = document.querySelector('.provider-info');
    return sel ? { opts: [...sel.options].map(o => o.textContent), val: sel.value, info: info ? info.textContent : '' } : null;
  })())`));
  check('API 服务商节点列出了已配置服务商', !!provWidget && provWidget.opts.length >= 1, JSON.stringify(provWidget && provWidget.opts));
  check('显示了服务商类型/模型状态', !!provWidget && /已启用|已停用/.test(provWidget.info), provWidget && provWidget.info);
  check('下拉默认选中第一个服务商', !!provWidget && !!provWidget.val, provWidget && provWidget.val);
  const providerNames = providers.map((p) => p.n);
  check('列表与设置里的服务商一致', !!provWidget && providerNames.every((n) => provWidget.opts.some((o) => o.includes(n))), JSON.stringify({ providerNames, opts: provWidget && provWidget.opts }));
  await shot('97-accept6-provider.png');

  // ============ 9. 标签重命名 / 另存为 ============
  console.log('\n=== 9. 工作流重命名 / 另存为 ===');
  const tab = await center('.tab');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tab.x, y: tab.y, button: 'left', buttons: 1, clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tab.x, y: tab.y, button: 'left', buttons: 0, clickCount: 2 });
  await sleep(350);
  check('双击标签出现重命名输入框', (await ev(`!!document.querySelector('.tab-rename')`)) === true);
  await ev(`(() => { const el = document.querySelector('.tab-rename'); el.focus(); el.select(); el.value=''; return 1 })()`);
  await send('Input.insertText', { text: '改名后的工作流' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(400);
  check('标签名称已更新', (await ev(`[...document.querySelectorAll('.tab-name')].some(e => e.textContent === '改名后的工作流')`)) === true);

  const saveAsBtn = await center('.rail .icon-btn', 3);
  await click(saveAsBtn.x, saveAsBtn.y);
  await sleep(500);
  const sa = JSON.parse(await ev(`JSON.stringify({
    open: !!document.querySelector('.saveas'),
    value: (document.querySelector('.saveas input') || {}).value || '',
    btn: [...document.querySelectorAll('.saveas .btn')].map(b => b.textContent.trim())
  })`));
  check('另存为对话框打开', sa.open === true);
  check('默认名称是「原名 副本」', /副本/.test(sa.value), sa.value);
  check('对话框有取消/保存按钮', sa.btn.includes('取消') && sa.btn.some((b) => b.includes('保存')), JSON.stringify(sa.btn));
  await shot('98-accept6-saveas.png');
  await ev(`(() => { const b=[...document.querySelectorAll('.saveas .btn')].find(x=>x.textContent.trim()==='取消'); b.click(); return 1 })()`);
  await sleep(300);
  check('取消后对话框关闭', (await ev(`!!document.querySelector('.saveas')`)) === false);

  // ============ 10. 控制台无报错 ============
  const logs = await ev(`JSON.stringify(window.__logs || [])`);
  check('控制台无报错', logs === '[]', logs.slice(0, 300));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  ws.close();
  edge.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); edge.kill(); process.exit(1); });
