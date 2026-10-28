/**
 * 全量扫描：457 个已注册节点，逐个「压到最小宽度」后检查组件行是否压住右侧输出名。
 * 判据：组件行右缘（图坐标）必须 ≤ 输出名左缘（nodeW - 10 - 文本宽）。
 */
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'

const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9900 + Math.floor(Math.random() * 20)
const profile = path.join(os.tmpdir(), 'pa' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 60000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
await sleep(9000)

const result = await send('Runtime.evaluate', {
  expression: `(async () => {
    const g = window.__comfyGraph
    const c = g.canvas
    const info = await (await fetch('/object_info')).json()
    const types = Object.keys(info).sort()
    const cr = c.canvas.getBoundingClientRect()
    c.ds.scale = 1; c.ds.offset[0] = 0; c.ds.offset[1] = 0
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const bad = []
    let tested = 0, skipped = 0
    for (const t of types) {
      let n = null
      try { n = g.addNode(t, [60, 60]) } catch (e) { n = null }
      if (!n) { skipped++; continue }
      try {
        const m = g.minSizeOf(n)
        n.setSize([m[0], Math.max(m[1], n.size[1])])
        g.refitNodeHeight(n)
        c.setDirty(true, true)
        await frame()
        const outs = n.outputs || []
        const ws = n.widgets || []
        if (!outs.length || !ws.length) { skipped++; continue }
        c.ctx.save(); c.ctx.font = c.inner_text_font
        let tw = 0, longName = ''
        for (const o of outs) {
          const tx = String(o.label != null ? o.label : o.name || '')
          const w = tx ? c.ctx.measureText(tx).width : 0
          if (w > tw) { tw = w; longName = tx }
        }
        c.ctx.restore()
        if (!tw) { skipped++; continue }
        const textLeft = n.getConnectionPos(false, 0)[0] - 10 - tw
        let worst = -999, worstRow = ''
        const s = c.ds.scale, o2 = c.ds.offset
        for (const w of ws) {
          const el = w.element
          if (!el) continue
          const r = el.getBoundingClientRect()
          if (!r.width) continue
          const right = (r.right - cr.left) / s - o2[0]
          const over = right - textLeft
          if (over > worst) { worst = over; worstRow = String(w.name || w.type) }
        }
        tested++
        if (worst > -0.5) bad.push({ type: t, w: Math.round(n.size[0]), out: longName, over: Math.round(worst * 10) / 10, row: worstRow })
      } finally {
        g.graph.remove(n)
      }
    }
    return { total: types.length, tested, skipped, bad }
  })()`,
  returnByValue: true, awaitPromise: true
})
const r = result.result.value
console.log(JSON.stringify(r, null, 1))
if (result.exceptionDetails) console.log('EXC', JSON.stringify(result.exceptionDetails.exception?.description))
console.log(`\n结果：${r.tested} 个节点带输出+组件，压到最小宽度后压字的有 ${r.bad.length} 个`)
ws.close(); edge.kill()
