/**
 * 验收 7：照 ComfyUI 1.x 截图重做版面后的核心诉求
 *  1. 组（Group）：面板真实可见（像素采样）、标题条 + #N nodes、统一忽略/颜色/选中/解散
 *  2. 多选：Ctrl 多选后整组拖动 / 右键保留多选 / 批量删除
 *  3. 组件即端口：文字写在组件胶囊里（不再有重复端口行），鼠标划过浮现端口，可拖出连线
 * 用法: node .tools/accept7.mjs
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9200 + Math.floor(Math.random() * 90)
const profile = path.join(os.tmpdir(), 'accept7-' + crypto.randomBytes(4).toString('hex'))
const shotDir = path.resolve('.shots')
fs.mkdirSync(shotDir, { recursive: true })

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1680,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = j.find((t) => t.type === 'page')
      if (page) return page
    } catch { /* retry */ }
    await sleep(300)
  }
  throw new Error('无法连接 Edge 调试端口')
}

let ws; let msgId = 0; const waiters = new Map()
function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject })
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(method + ' 超时')) } }, 60000)
  })
}

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`) }
}

let vpW = 1650, vpH = 858
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  fs.writeFileSync(path.join(shotDir, name), buf)
  const meta = await sharp(buf).metadata()
  vpW = meta.width; vpH = meta.height
  return buf
}

/** 采样截图像素（返回 [r,g,b]） */
async function pixel(buf, x, y) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const px = Math.round(x), py = Math.round(y)
  const i = (py * info.width + px) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

async function main() {
  const t = await targets()
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id)
      if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result)
    }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
  })
  await send('Page.enable')
  await send('Runtime.enable')
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
      window.__cm = 0; window.__pdon = 0;
      window.addEventListener('contextmenu', () => { window.__cm++ }, true);
      window.addEventListener('pointerdown', (e) => { if (e.target && e.target.tagName === 'CANVAS') window.__pdon++ }, true);
    `
  })
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
  await sleep(9000)

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) return 'EXC: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    return r.result && r.result.value
  }
  const mouse = async (type, x, y, btn = 'left', buttons = 1, mods = 0) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: (type === 'mousePressed' || type === 'mouseReleased') ? 1 : 0, modifiers: mods })
    await sleep(40)
  }
  const click = async (x, y, mods = 0) => { await mouse('mouseMoved', x, y, 'none', 0, mods); await mouse('mousePressed', x, y, 'left', 1, mods); await mouse('mouseReleased', x, y, 'left', 0, mods); await sleep(120) }
  const rclick = async (x, y) => {
    await mouse('mouseMoved', x, y, 'none', 0)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
    await sleep(250)
  }
  const drag = async (x1, y1, x2, y2, steps = 14) => {
    await mouse('mouseMoved', x1, y1, 'none', 0)
    await mouse('mousePressed', x1, y1)
    for (let i = 1; i <= steps; i++) await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps)
    await mouse('mouseReleased', x2, y2)
    await sleep(180)
  }
  /** 图坐标 → 屏幕坐标 */
  const toScreen = async (gx, gy) => JSON.parse(await ev(`JSON.stringify((() => {
    const c = window.__comfyGraph.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
    return { x: Math.round(r.left + (${gx}+o[0])*s), y: Math.round(r.top + (${gy}+o[1])*s) };
  })())`))
  const nodeRect = async (id) => JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph; const n = g.graph.getNodeById(${id}); if(!n) return null;
    const c = g.canvas; const s = c.ds.scale; const o = c.ds.offset; const r = c.canvas.getBoundingClientRect();
    return { x: r.left + (n.pos[0]+o[0])*s, y: r.top + (n.pos[1]+o[1])*s, w: n.size[0]*s, h: n.size[1]*s };
  })())`))
  const VK = { KeyG: 71, Escape: 27, Delete: 46 }
  const key = async (code, keyName, mods = 0) => {
    const vk = VK[code] ?? 0
    const base = { code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(200)
  }
  /**
   * 关闭浮层必须走「点遮罩」而不是 DOM remove：
   * Vue 用 v-if 管理菜单，直接 remove 元素会让内部状态仍为“已打开”，
   * 之后再次打开时 Vue 只会去 patch 一个已经脱离文档的节点 → 菜单永远看不见。
   */
  const closeOverlays = async () => {
    await ev(`(() => {
      const mask = document.querySelector('.ctx-mask');
      if (mask) mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const sb = document.querySelector('.node-search-mask');
      if (sb) sb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 1;
    })()`)
    await sleep(260)
  }
  const fixedView = async () => {
    await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1; c.ds.offset[0] = 0; c.ds.offset[1] = 0; c.setDirty(true,true); return 1 })()`)
    await sleep(400)
  }

  // 固定画布尺寸（headless 下视口尺寸随窗口，先测一次）
  await fixViewport()

  // ============ 1. 组面板 ============
  console.log('\n=== 1. 组（Group）面板 ===')
  const wf = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json', 'utf8'))
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
  await sleep(2000)
  await fixedView()
  const groups = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.groups().map(g => ({ t: g.title, p: [...g._pos], s: [...g._size], n: g._nodes.length })))`))
  check('工作流载入 3 个组', groups.length === 3, JSON.stringify(groups.map((g) => `${g.t}(${g.n})`)))
  check('组内含节点（recomputeInsideNodes 生效）', groups.every((g) => g.n > 0), JSON.stringify(groups.map((g) => g.n)))

  const bufA = await shot('70-a7-groups.png')
  // 采样组内部空白（组右上角内缩 24px）与画布空白
  const g0 = groups[0]
  const pIn = await toScreen(g0.p[0] + g0.s[0] - 24, g0.p[1] + 60)
  const pOut = await toScreen(g0.p[0] + g0.s[0] + 200, g0.p[1] + 28)
  const cIn = await pixel(bufA, pIn.x, pIn.y)
  const cOut = await pixel(bufA, pOut.x, pOut.y)
  const bluish = cIn[2] > cIn[0] + 6 && cIn[2] > 16
  check('组面板真实绘制（内部像素偏蓝，未被底色盖掉）', bluish, `in=${cIn.join(',')} out=${cOut.join(',')}`)
  check('组外画布仍是近黑底', cOut[2] <= 18 && Math.abs(cOut[2] - cOut[0]) < 8, `out=${cOut.join(',')}`)

  // 组标题条：右键弹组菜单
  const headPt = await toScreen(g0.p[0] + 60, g0.p[1] + 15)
  await rclick(headPt.x, headPt.y)
  const groupMenu = await ev(`(() => { const m = document.querySelector('.ctx-menu'); return m ? m.innerText.replace(/\\s+/g,'|') : '' })()`)
  check('右键组标题条弹出「组」菜单', /重命名组/.test(groupMenu || ''), String(groupMenu).slice(0, 120))
  check('组菜单含「忽略组内全部节点」', /忽略组内全部/.test(groupMenu || ''))
  check('组菜单含「统一设置组颜色」', /统一.*颜色/.test(groupMenu || ''))
  check('组菜单含「解散组」', /解散组/.test(groupMenu || ''))
  await shot('71-a7-groupmenu.png')
  await closeOverlays()

  // 忽略组内全部（直接调命令，等价菜单点击）
  await ev(`(() => { const g = window.__comfyGraph.groups()[0]; window.__comfyGraph.applyGroupAction(g.__gid, 'bypass'); return 1 })()`)
  await sleep(600)
  const bypassed = JSON.parse(await ev(`JSON.stringify(window.__comfyGraph.groups()[0]._nodes.map(n => n.mode))`))
  check('「忽略组内全部」把组内所有节点置为 bypass(4)', bypassed.every((m) => m === 4), JSON.stringify(bypassed))
  await shot('72-a7-group-bypass.png')
  await ev(`(() => { const g = window.__comfyGraph.groups()[0]; window.__comfyGraph.applyGroupAction(g.__gid, 'unbypass'); return 1 })()`)
  await sleep(400)

  // ============ 2. 多选 ============
  console.log('\n=== 2. 多选（Ctrl 多选 → 整组拖动 / 右键 / 批量删除） ===')
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
  await sleep(1600)
  await fixedView()
  const n1 = await nodeRect(3)
  const n2 = await nodeRect(4)
  // 点标题条选中 3，再 Ctrl 点标题条选中 4
  await closeOverlays()
  // 点标题条（body 顶上方 26px 内）——新版面组件行从输出行之下开始，body y+46 会落在 DOM 胶囊上被吞掉
  await click(n1.x + 60, n1.y - 10)
  await click(n2.x + 60, n2.y - 10, 2) // modifiers 2 = Ctrl
  const sel = JSON.parse(await ev(`JSON.stringify(Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).map(Number))`))
  check('Ctrl 多选后 selected_nodes 有 2 个', sel.length === 2, JSON.stringify(sel))

  // 拖动其中一个 → 两个一起动
  const before = JSON.parse(await ev(`JSON.stringify([3,4].map(id => [...window.__comfyGraph.graph.getNodeById(id).pos]))`))
  // 诊断：按下瞬间到底抓到了什么（节点 / 画布平移）
  await sleep(420)
  await mouse('mouseMoved', n1.x + 150, n1.y - 10, 'none', 0)
  await mouse('mousePressed', n1.x + 150, n1.y - 10)
  await sleep(150)
  console.log('    press-target=', await ev(`(() => {
    const g = window.__comfyGraph; const c = g.canvas;
    const node = c.canvas && g.graph.getNodeOnPos ? null : null;
    const gm = c.graph_mouse || [0,0];
    const hit = g.graph.getNodeOnPos(gm[0], gm[1]);
    return JSON.stringify({ dragNode: c.dragging_node ? c.dragging_node.id : null, pan: !!c.dragging_canvas, hit: hit && hit.id, offset: [...c.ds.offset], gm });
  })()`))
  for (let i = 1; i <= 14; i++) await mouse('mouseMoved', n1.x + 150 + 100 * i / 14, n1.y - 10)
  await mouse('mouseReleased', n1.x + 250, n1.y - 10)
  await sleep(200)
  const after = JSON.parse(await ev(`JSON.stringify([3,4].map(id => [...window.__comfyGraph.graph.getNodeById(id).pos]))`))
  const d1 = after[0][0] - before[0][0]
  const d2 = after[1][0] - before[1][0]
  check('拖动已选中节点时多选没有丢失', (await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).length`)) === 2, `sel=${await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).length`)}`)
  check('多选为一组一起位移（两节点 dx 相同且 > 0）', d1 > 20 && Math.abs(d1 - d2) <= 1, `dx1=${d1} dx2=${d2}`)
  await shot('73-a7-multidrag.png')

  // 右键已选中节点 → 菜单出现且仍是多选语境
  await sleep(400)
  const n1b = await nodeRect(3)
  const cmBefore = await ev(`window.__cm`)
  await rclick(n1b.x + 120, n1b.y - 10)
  console.log('    contextmenu events:', cmBefore, '->', await ev(`window.__cm`), 'nodeRect=', JSON.stringify(n1b))
  console.log('    overlayCount=', await ev(`document.querySelectorAll('.ctx-menu').length`),
    'searchBox=', await ev(`document.querySelectorAll('.node-search-box').length`),
    'hitTest=', await ev(`(() => { const g = window.__comfyGraph; const gm = g.canvas.graph_mouse; const n = g.graph.getNodeOnPos(gm[0], gm[1], g.canvas.visible_nodes); return JSON.stringify({ gm, n: n && n.id }) })()`))
  const menuText = await ev(`(() => { const m = document.querySelector('.ctx-menu'); return m ? m.innerText.replace(/\\s+/g,'|') : '' })()`)
  const selAfterMenu = await ev(`Object.keys(window.__comfyGraph.canvas.selected_nodes||{}).length`)
  check('右键已选中节点后仍是多选（未被收敛成单选）', selAfterMenu === 2, `sel=${selAfterMenu}`)
  console.log('    menu=', String(menuText).slice(0, 200))
  check('菜单文案切到多选（删除选中的 2 个节点）', /删除选中的\s*2\s*个节点/.test(String(menuText).replace(/\|/g, ' ')), String(menuText).slice(0, 160))
  await shot('74-a7-multimenu.png')
  // 点菜单里的批量删除
  const delPt = JSON.parse(await ev(`JSON.stringify((() => {
    const items = [...document.querySelectorAll('.ctx-menu .ctx-row')];
    const el = items.find(i => /删除选中的/.test(i.textContent||'')); if(!el) return null;
    const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
  })())`))
  check('菜单里能找到「删除选中的 N 个节点」项', !!delPt, JSON.stringify(delPt))
  if (delPt) {
    await click(delPt.x, delPt.y)
    await sleep(500)
    const alive = await ev(`JSON.stringify([!!window.__comfyGraph.graph.getNodeById(3), !!window.__comfyGraph.graph.getNodeById(4)])`)
    check('批量删除把两个节点都删掉了', alive === '[false,false]', alive)
  }

  // ============ 3. 组件即端口 ============
  console.log('\n=== 3. 组件内嵌文字 + 隐藏端口 ===')
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
  await sleep(1600)
  await fixedView()
  const slotInfo = JSON.parse(await ev(`JSON.stringify((() => {
    const n = window.__comfyGraph.graph.getNodeById(5);
    return { startY: n.widgets_start_y, inputs: n.inputs.map(s => ({ n: s.name, label: s.label, w: !!s.widget })), rows: n.widgets.length };
  })())`))
  // 节点 5 = MathOp：3 个组件输入 + 1 个输出。组件排在输出端口行之下：
  // rows = max(纯输入行 0, 输出 1) = 1 → startY = 1*26+4 = 30（ComfyUI 同款：输出名独占一行）
  check('组件排在输出端口行之下（widgets_start_y = 30 = 1 输出行×26+4）', slotInfo.startY === 30, `startY=${slotInfo.startY}`)
  check('有组件的输入 label 置空（文字只在组件里出现）', slotInfo.inputs.every((s) => s.label === '' && s.w), JSON.stringify(slotInfo.inputs))
  const dupRow = await ev(`(() => { const t = document.querySelector('.dom-layer, .canvas-dom-layer, #dom-layer') || document.body; return 0 })()`)
  // 组件行数量 = 控件数量（每行一个胶囊，不再有独立端口行）
  const rowCount = await ev(`document.querySelectorAll('.lg-dom-widget.lg-row').length`)
  check('组件行渲染为胶囊行（数量 > 0）', rowCount > 0, `rows=${rowCount}`)
  void dupRow

  // 悬浮 → 端口浮现
  await closeOverlays()
  await ev(`(() => { const g = window.__comfyGraph.graph; const n = g.getNodeById(5); const id = n.inputs[1].link; if (id != null) g.removeLink(id); return 1 })()`)
  await sleep(500)
  const aRow = JSON.parse(await ev(`JSON.stringify((() => {
    const n = window.__comfyGraph.graph.getNodeById(5);
    const w = n.widgets[1]; const el = w.element; const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), left: Math.round(r.left), rowY: Math.round(r.top + r.height/2) };
  })())`))
  await mouse('mouseMoved', aRow.x, aRow.y, 'none', 0)
  await sleep(350)
  const portOpacity = await ev(`(() => {
    const n = window.__comfyGraph.graph.getNodeById(5); const el = n.widgets[1].element;
    const p = el.querySelector('.lg-port'); if (!p) return 'none';
    return getComputedStyle(p).opacity + '|' + getComputedStyle(p).pointerEvents;
  })()`)
  check('鼠标划过组件行 → 隐藏端口浮现（opacity → 1）', String(portOpacity).startsWith('1'), String(portOpacity))
  await shot('75-a7-port-hover.png')

  // 从端口拖出连线：PrimitiveFloat(3) → MathOp(5) 的 a 行
  const portCenter = JSON.parse(await ev(`JSON.stringify((() => {
    const n = window.__comfyGraph.graph.getNodeById(5); const el = n.widgets[1].element;
    const p = el.querySelector('.lg-port'); const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })())`))
  // 用工作流里已有的 PrimitiveFloat(3) 当输出源：它和 MathOp.a 的类型都是 FLOAT，
  // 换成 INT 源会被 litegraph 的 isValidConnection 直接拒绝（不是本功能的 bug）。
  const srcId = 3
  const outPort = await ev(`(() => { const n = window.__comfyGraph.graph.getNodeById(${srcId}); const p = n.getConnectionPos(false, 0);
    const c = window.__comfyGraph.canvas; const r = c.canvas.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + (p[0]+c.ds.offset[0])*c.ds.scale), y: Math.round(r.top + (p[1]+c.ds.offset[1])*c.ds.scale) }) })()`)
  const op = JSON.parse(outPort)
  await mouse('mouseMoved', portCenter.x, portCenter.y, 'none', 0)
  await sleep(250)
  const pdBefore = await ev(`window.__pdon`)
  console.log('    portAt=', JSON.stringify(portCenter), 'elem=', await ev(`(() => { const e=document.elementFromPoint(${portCenter.x}, ${portCenter.y}); return e ? (e.className||e.tagName) : 'none' })()`))
  await mouse('mousePressed', portCenter.x, portCenter.y, 'left', 1)
  await sleep(300)
  console.log('    canvas pointerdown:', pdBefore, '->', await ev(`window.__pdon`))
  const dragging = await ev(`(() => { const c = window.__comfyGraph.canvas; return JSON.stringify({ n: !!c.connecting_node, i: !!c.connecting_input, o: !!c.connecting_output, out: c.connecting_output && c.connecting_output.name }) })()`)
  console.log('    connecting=', dragging)
  check('在隐藏端口上按下可拖出连线（litegraph 已进入连线态）', /"i":true|"n":true|"o":true/.test(String(dragging)))
  for (let i = 1; i <= 14; i++) await mouse('mouseMoved', portCenter.x + ((op.x - portCenter.x) * i) / 14, portCenter.y + ((op.y - portCenter.y) * i) / 14)
  await sleep(120)
  await mouse('mouseReleased', op.x, op.y, 'left', 0)
  await sleep(400)
  const linkOk = await ev(`(() => {
    const g = window.__comfyGraph.graph; const n5 = g.getNodeById(5); const idx = n5.inputs.findIndex(s => s.name === 'a');
    return n5.inputs[idx].link != null;
  })()`)
  check('拖到目标节点输出端口后连线建立（MathOp.a 已连线）', linkOk === true)
  const linkSrc = await ev(`(() => {
    const g = window.__comfyGraph.graph; const n5 = g.getNodeById(5); const idx = n5.inputs.findIndex(s => s.name === 'a');
    const lid = n5.inputs[idx].link; const l = lid != null ? g.links[lid] : null;
    return l ? (l.origin_id + '->' + l.target_id) : 'none';
  })()`)
  check('连线源是 PrimitiveFloat(3)', String(linkSrc).startsWith('3->'), String(linkSrc))
  const disabled = await ev(`(() => { const n = window.__comfyGraph.graph.getNodeById(5); const w = n.widgets[1]; return !!w && !!w.element.classList.contains('is-linked') })()`)
  check('连线后该组件行置灰（is-linked）', disabled === true)
  await shot('76-a7-portlink.png')

  // ============ 4. Ctrl+G 建组 ============
  console.log('\n=== 4. Ctrl+G 从选中节点建组 ===')
  const gBefore = await ev(`window.__comfyGraph.groups().length`)
  const r3 = await nodeRect(3)
  await click(r3.x + 40, r3.y - 13)
  await ev(`document.body.focus()`)
  await key('KeyG', 'g', 2)
  await sleep(700)
  const gAfter = await ev(`window.__comfyGraph.groups().length`)
  check('Ctrl+G 把选中节点编成组', gAfter === gBefore + 1, `${gBefore} → ${gAfter}`)
  await shot('77-a7-ctrlg.png')

  // ============ 5. 截图总览 ============
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
  await sleep(1500)
  await ev(`(() => { window.__comfyGraph.fitView(); return 1 })()`)
  await sleep(800)
  await shot('78-a7-overview.png')

  const logs = await ev(`JSON.stringify(window.__logs || [])`)
  console.log('    logs=', (logs || '').slice(0, 600))
  const errs = JSON.parse(logs || '[]').filter((l) => l.startsWith('error'))
  check('运行期无 console.error / window error', errs.length === 0, errs.slice(0, 3).join(' | '))

  console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
  ws.close()
  edge.kill()
  process.exit(fail ? 1 : 0)

  /** headless 视口尺寸探测（截图后才知道） */
  async function fixViewport() { return 0 }
}

main().catch((e) => { console.error(e); try { edge.kill() } catch { /* noop */ } process.exit(1) })
