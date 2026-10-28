/**
 * 两项验收探针：
 *  A. 组件行不能压住右侧输出名（输出列宽度按最长输出名实测）
 *  B. 折叠节点时 DOM 控件层必须一起隐藏（litegraph 折叠时不调 drawNodeWidgets）
 */
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'

const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9880 + Math.floor(Math.random() * 20)
const profile = path.join(os.tmpdir(), 'po' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description) : r.result.value }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync('.shots', { recursive: true }); fs.writeFileSync('.shots/' + name, Buffer.from(r.data, 'base64')) }
let pass = 0, fail = 0
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`) }

// ---------- A. 输出名不被组件行压住 ----------
console.log('\n=== A. 输出列宽度（不压输出名） ===')
for (const file of ['03-图像预览.json', '04-三链合一.json', '02-文本数学.json']) {
  const p = 'public/examples/' + file
  if (!fs.existsSync(p)) continue
  const wf = JSON.parse(fs.readFileSync(p, 'utf8'))
  await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf)}); return 1 })()`)
  await sleep(1500)
  await ev(`(() => { const c = window.__comfyGraph.canvas; c.ds.scale = 1; c.ds.offset[0] = 40; c.ds.offset[1] = 40; c.setDirty(true, true); return 1 })()`)
  await sleep(500)
  const res = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__comfyGraph.graph, c = window.__comfyGraph.canvas
    const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale
    c.ctx.save(); c.ctx.font = c.inner_text_font
    const out = []
    for (const n of Object.values(g._nodes)) {
      const outs = n.outputs || []
      if (!outs.length || !n.widgets || !n.widgets.length) continue
      let tw = 0, longName = ''
      for (const o of outs) {
        const t = String(o.label != null ? o.label : o.name || '')
        const w = t ? c.ctx.measureText(t).width : 0
        if (w > tw) { tw = w; longName = t }
      }
      if (!tw) continue
      const textLeft = n.getConnectionPos(false, 0)[0] - 10 - tw   // 输出锚点 - 10 = 文本右缘（图坐标）
      let worst = null
      for (const w of n.widgets) {
        const el = w.element
        if (!el || el.style.display === 'none') continue
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        const right = (r.right - cr.left) / s - c.ds.offset[0]
        const over = right - textLeft
        if (!worst || over > worst.over) worst = { over: Math.round(over * 10) / 10, right: Math.round(right * 10) / 10 }
      }
      out.push({ id: n.id, type: n.type, name: longName, textLeft: Math.round(textLeft * 10) / 10, rowRight: worst ? worst.right : null, overlap: worst ? worst.over : null })
    }
    c.ctx.restore()
    return out
  })())`))
  const bad = res.filter((r) => r.overlap != null && r.overlap > -0.5)
  for (const r of res) console.log(`    #${r.id} ${r.type} 输出名「${r.name}」 textLeft=${r.textLeft} rowRight=${r.rowRight} overlap=${r.overlap}`)
  check(`${file}: ${res.length} 个带输出节点，组件行右缘都在输出名左边`, bad.length === 0, bad.length ? JSON.stringify(bad) : '')
}

// ---------- A2. 窄节点 + 长输出名（压到最小宽度也不压字） ----------
console.log('\n=== A2. 压到最小宽度 / 长输出名 ===')
await ev(`(() => {
  const g = window.__comfyGraph; g.graph.clear()
  g.addNode('KSampler', [80, 80])        // MODEL / CONDITIONING / LATENT（长名）
  g.addNode('LoadImage', [80, 420])      // IMAGE / MASK
  g.addNode('PrimitiveFloat', [80, 760])
  g.fitView(); return 1
})()`)
await sleep(1200)
const narrow = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas
  const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale
  c.ctx.save(); c.ctx.font = c.inner_text_font
  const out = []
  for (const n of Object.values(g.graph._nodes)) {
    const m = g.minSizeOf(n)
    n.setSize([m[0], n.size[1]])          // 压到允许的最小宽度
    g.refitNodeHeight(n)
  }
  c.setDirty(true, true)
  return { ids: Object.values(g.graph._nodes).map(n => ({ id: n.id, type: n.type, w: Math.round(n.size[0]), min: g.minSizeOf(n) })) }
})())`))
await sleep(700)
const narrowCheck = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph, c = g.canvas
  const cr = c.canvas.getBoundingClientRect(), s = c.ds.scale
  c.ctx.save(); c.ctx.font = c.inner_text_font
  const out = []
  for (const n of Object.values(g.graph._nodes)) {
    const outs = n.outputs || []
    if (!outs.length || !n.widgets || !n.widgets.length) continue
    let tw = 0, longName = ''
    for (const o of outs) {
      const t = String(o.label != null ? o.label : o.name || '')
      const w = t ? c.ctx.measureText(t).width : 0
      if (w > tw) { tw = w; longName = t }
    }
    if (!tw) continue
    const textLeft = n.getConnectionPos(false, 0)[0] - 10 - tw
    let worst = -999
    for (const w of n.widgets) {
      const el = w.element
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (!r.width) continue
      worst = Math.max(worst, (r.right - cr.left) / s - c.ds.offset[0] - textLeft)
    }
    out.push({ id: n.id, type: n.type, name: longName, w: Math.round(n.size[0]), overlap: Math.round(worst * 10) / 10 })
  }
  c.ctx.restore()
  return out
})())`))
for (const r of narrowCheck) console.log(`    #${r.id} ${r.type}(${r.w}px) 输出名「${r.name}」 overlap=${r.overlap}`)
check('最小宽度下仍不压输出名（含 CONDITIONING 长名）', narrowCheck.every((r) => r.overlap <= -0.5), JSON.stringify(narrowCheck))
await shot('95-outcol-narrow.png')

// ---------- B. 折叠节点 ----------
console.log('\n=== B. 折叠节点：组件一起收起来 ===')
const wf3 = JSON.parse(fs.readFileSync('public/examples/03-图像预览.json', 'utf8'))
await ev(`(() => { window.__comfyGraph.loadWorkflow(${JSON.stringify(wf3)}); return 1 })()`)
await sleep(1500)

const before = JSON.parse(await ev(`JSON.stringify((() => {
  const n = Object.values(window.__comfyGraph.graph._nodes).find(x => (x.widgets || []).some(w => w.type === 'dom-block') || (x.widgets || []).some(w => w.type === 'dom-thumb'))
  return n ? { id: n.id, type: n.type, widgets: n.widgets.length, visible: n.widgets.filter(w => w.element && w.element.getBoundingClientRect().width > 0).length } : null
})())`))
check('示例里有可折叠的节点（含组件）', before != null, JSON.stringify(before))

// 走真实菜单：右键节点 → 点「折叠节点」
const rect = JSON.parse(await ev(`JSON.stringify((() => {
  const g = window.__comfyGraph; const n = g.graph.getNodeById(${before.id}); const c = g.canvas
  const s = c.ds.scale, o = c.ds.offset, r = c.canvas.getBoundingClientRect()
  return { x: r.left + (n.pos[0] + o[0]) * s, y: r.top + (n.pos[1] + o[1]) * s, w: n.size[0] * s, h: n.size[1] * s }
})())`))
const mouse = async (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
await mouse('mousePressed', Math.round(rect.x + rect.w / 2), Math.round(rect.y + 14), 'right')
await mouse('mouseReleased', Math.round(rect.x + rect.w / 2), Math.round(rect.y + 14), 'right')
await sleep(500)
const menuRows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.ctx-menu .ctx-row')].map(b => b.textContent.trim()))`))
check('右键菜单有「折叠节点」', menuRows.some((t) => t.includes('折叠')), JSON.stringify(menuRows))
const idx = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.ctx-menu .ctx-row')].findIndex(b => b.textContent.includes('折叠')))`))
await ev(`(() => { const b = [...document.querySelectorAll('.ctx-menu .ctx-row')][${idx}]; b.click(); return 1 })()`)
await sleep(700)

const collapsed = JSON.parse(await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(${before.id})
  const els = (n.widgets || []).map(w => w.element).filter(Boolean)
  return {
    flag: !!n.flags.collapsed,
    total: els.length,
    shown: els.filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none').length,
    note: '折叠后应 shown=0'
  }
})())`))
check('节点已进入折叠态', collapsed.flag === true, JSON.stringify(collapsed))
check('折叠后所有组件 DOM 都隐藏了', collapsed.shown === 0, JSON.stringify(collapsed))
await shot('96-collapse-fixed.png')

// 再展开
await ev(`(() => { window.__comfyGraph.toggleCollapse(${before.id}); return 1 })()`)
await sleep(700)
const expanded = JSON.parse(await ev(`JSON.stringify((() => {
  const n = window.__comfyGraph.graph.getNodeById(${before.id})
  const els = (n.widgets || []).map(w => w.element).filter(Boolean)
  const first = els[0]
  return { flag: !!n.flags.collapsed, shown: els.filter(el => el.getBoundingClientRect().width > 0).length, total: els.length, w: first ? Math.round(first.getBoundingClientRect().width) : 0 }
})())`))
check('展开后组件全部回来', expanded.flag === false && expanded.shown === expanded.total && expanded.shown > 0, JSON.stringify(expanded))
await shot('97-expand-fixed.png')

const errs = await ev(`JSON.stringify((window.__logs || []).filter(l => /error/i.test(String(l.level || l.type || '')))) `)
console.log('\n控制台 error:', errs)
console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
ws.close(); edge.kill()
