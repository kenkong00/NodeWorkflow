/**
 * 验收 8：左侧节点库的「只显示本机可运行的节点」是否同样作用于
 * 画布右键的「搜索节点」浮层（默认勾选 / 默认过滤 / 关掉后恢复）。
 * 用法: node .tools/accept8.mjs
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9500 + Math.floor(Math.random() * 60)
const profile = path.join(os.tmpdir(), 'a8-' + crypto.randomBytes(4).toString('hex'))
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
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
  await sleep(9000)

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) return 'EXC: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    return r.result && r.result.value
  }
  const mouse = async (type, x, y, btn = 'left', buttons = 1) => {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, buttons, clickCount: (type === 'mousePressed' || type === 'mouseReleased') ? 1 : 0 })
    await sleep(45)
  }
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(150) }
  const rclick = async (x, y) => {
    await mouse('mouseMoved', x, y, 'none', 0)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 1, clickCount: 1 })
    await sleep(350)
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, 'base64'))
  }
  /** 关浮层：必须点遮罩（Vue 用 v-if 管理，DOM remove 会让内部状态与 DOM 脱节） */
  const closeOverlays = async () => {
    await ev(`(() => {
      const m = document.querySelector('.node-search-mask');
      if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 1 })()`)
    await sleep(250)
  }
  /** 打开画布右键搜索框，输入关键字，返回列表文本 */
  const canvasSearch = async (q) => {
    await closeOverlays()
    const pt = await ev(`(() => { const c = window.__comfyGraph.canvas; const r = c.canvas.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width * 0.62), y: Math.round(r.top + r.height * 0.72) }) })()`)
    const p = JSON.parse(pt)
    await rclick(p.x, p.y)
    const opened = await ev(`document.querySelectorAll('.node-search-box').length`)
    if (!opened) return { opened: 0, rows: [], total: 0 }
    await ev(`(() => { const i = document.querySelector('.nsb-input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
    await sleep(350)
    const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.nsb-row')].map(r => r.querySelector('.nm').textContent + '|' + r.querySelector('.cat').textContent))`))
    const total = await ev(`(() => { const e = document.querySelector('.nsb-count'); return e ? Number(e.textContent) : -1 })()`)
    const tag = await ev(`document.querySelectorAll('.nsb-native-tag').length`)
    const emptyText = await ev(`(() => { const e = document.querySelector('.nsb-empty'); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : '' })()`)
    return { opened: 1, rows, total, tag, emptyText }
  }

  // ============ 1. 默认状态 ============
  console.log('\n=== 1. 开关默认勾选 + 节点库已过滤 ===')
  const cb = await ev(`(() => { const el = document.querySelector('.lp-filter input[type=checkbox]'); return el ? el.checked : null })()`)
  check('「只显示本机可运行的节点」默认勾选', cb === true, `checked=${cb}`)
  const counts = JSON.parse(await ev(`JSON.stringify((() => {
    const s = window.__pinia ? null : null;
    const all = Object.keys(window.__comfyGraph ? {} : {});
    return { lib: Number(document.querySelector('.lp-count')?.textContent || 0) };
  })())`))
  const stats = JSON.parse(await ev(`(() => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    const st = pinia.state.value.comfy;
    const all = Object.keys(st.nodeDefs).length;
    const vis = Object.values(st.nodeDefs).filter(d => d.native).length;
    return JSON.stringify({ all, vis, only: st.onlyNative });
  })()`))
  check('store 里 onlyNative = true', stats.only === true, JSON.stringify(stats))
  check('注册表里确实存在「非 native」节点（否则本用例无意义）', stats.all > stats.vis, `all=${stats.all} native=${stats.vis}`)
  check('左侧节点库计数 = native 数量', counts.lib === stats.vis, `lib=${counts.lib} vis=${stats.vis}`)

  // 挑一个非 native 节点做探针
  const probe = JSON.parse(await ev(`(() => {
    const app = document.querySelector('#app').__vue_app__;
    const st = app.config.globalProperties.$pinia.state.value.comfy;
    const def = Object.values(st.nodeDefs).find(d => !d.native);
    return JSON.stringify(def ? { name: def.name, dn: def.display_name || def.name } : null);
  })()`))
  console.log('    非 native 探针节点 =', JSON.stringify(probe))
  check('取到一个非 native 节点作为探针', !!probe)

  // ============ 2. 右键搜索框默认不出现非 native 节点 ============
  console.log('\n=== 2. 画布右键搜索框（默认开启时）===')
  const s1 = await canvasSearch(probe ? probe.name : 'LoadImage')
  check('右键画布弹出「搜索节点」浮层', s1.opened === 1)
  check('浮层显示「仅本机可运行」标签', s1.tag === 1, `tag=${s1.tag}`)
  check('搜非 native 节点名 → 列表为空', s1.total === 0 && s1.rows.length === 0, `total=${s1.total} rows=${s1.rows.length}`)
  check('空状态给出「已隐藏 N 个」提示', /已隐藏\s*\d+\s*个/.test(s1.emptyText || ''), s1.emptyText)
  await shot('80-a8-search-filtered.png')
  await closeOverlays()

  // 常见节点仍可搜到
  const s2 = await canvasSearch('LoadImage')
  check('本机节点仍能搜到（LoadImage）', s2.total > 0 && s2.rows.some((r) => r.includes('LoadImage')), JSON.stringify(s2.rows.slice(0, 3)))
  await closeOverlays()

  // ============ 3. 关掉开关 → 搜索框恢复全部 ============
  console.log('\n=== 3. 取消勾选后，搜索框恢复全部节点 ===')
  const cbPos = JSON.parse(await ev(`(() => { const el = document.querySelector('.lp-filter'); const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) })()`))
  await click(cbPos.x, cbPos.y)
  await sleep(400)
  const offState = await ev(`(() => { const el = document.querySelector('.lp-filter input[type=checkbox]'); return el.checked })()`)
  check('点击后复选框取消勾选', offState === false, `checked=${offState}`)
  const s3 = await canvasSearch(probe ? probe.name : 'LoadImage')
  check('取消勾选后能搜到该非 native 节点', s3.total > 0 && s3.rows.some((r) => r.includes(probe.name)), `total=${s3.total}`)
  check('取消勾选后不再显示「仅本机可运行」标签', s3.tag === 0, `tag=${s3.tag}`)
  await shot('81-a8-search-all.png')
  await closeOverlays()

  // 持久化：重新加载页面应保持「未勾选」
  console.log('\n=== 4. 选择被记住（localStorage）===')
  const saved = await ev(`localStorage.getItem('comfy.onlyNative')`)
  check('localStorage 记录了开关状态', saved === '0', `value=${saved}`)
  await send('Page.reload')
  await sleep(9000)
  const afterReload = await ev(`(() => { const el = document.querySelector('.lp-filter input[type=checkbox]'); return el ? el.checked : null })()`)
  check('刷新后仍是未勾选', afterReload === false, `checked=${afterReload}`)
  // 恢复默认（勾上），避免影响后续用例
  const cbPos2 = JSON.parse(await ev(`(() => { const el = document.querySelector('.lp-filter'); const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) })()`))
  await click(cbPos2.x, cbPos2.y)
  await sleep(300)
  const restored = await ev(`(() => { const el = document.querySelector('.lp-filter input[type=checkbox]'); return el.checked })()`)
  check('恢复勾选（回到默认）', restored === true, `checked=${restored}`)

  console.log(`\n===== 结果：PASS ${pass} / FAIL ${fail} =====`)
  ws.close()
  edge.kill()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); try { edge.kill() } catch { /* noop */ } process.exit(1) })
