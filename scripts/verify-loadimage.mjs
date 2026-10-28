/**
 * 验证：① 节点库 image 分类「加载图像」只剩一个（去重修好）
 *       ② 画布上的「加载图像」节点带上传按钮 + 缩略图（能加载图片）
 *       ③ 打开工作流侧栏悬浮、名称无按钮边框
 * 用法：node scripts/verify-loadimage.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://127.0.0.1:5173/'
const PORT = 9341
const OUT = path.resolve(process.cwd(), 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-v-'))
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-component-update', '--disable-background-networking',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (r.ok) {
        const list = await r.json()
        const page = list.find((t) => t.type === 'page')
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      }
    } catch { /* 还没好 */ }
    await sleep(500)
  }
  throw new Error('CDP 端点未就绪')
}
const ws = new WebSocket(await waitEndpoint())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
function send(method, params = {}) {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')) } }, 60000)
  })
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
  console.log('📷', name)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(9000)

// 1. 默认界面（节点库）
await shot('v01-主界面.png')

// 2. 搜索「加载图像」，统计结果数量（应为 1）
await evaluate(`(() => {
  const inp = document.querySelector('.lp-search input') || document.querySelector('input[placeholder*="搜索节点"]');
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '加载图像');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok'
})()`)
await sleep(900)
const count = await evaluate(`(() => {
  return [...document.querySelectorAll('.node-item')].filter(e => /加载图像/.test(e.textContent || '')).length
})()`)
console.log('节点库中显示「加载图像」的数量 =', count, count === 1 ? '✅ 去重正确' : '⚠️ 异常')
await shot('v02-搜索加载图像.png')

// 3. 点第一个「加载图像」节点项，加到画布中心
await evaluate(`(() => {
  const el = [...document.querySelectorAll('.node-item')].find(e => /加载图像/.test(e.textContent || ''));
  if (!el) return false; el.click(); return true
})()`)
await sleep(1200)
// 检查该节点是否带上传按钮 + 缩略图
const nodeInfo = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.litegraph .graphnode, .litegraph .node, canvas')];
  // 找 DOM 控件：上传按钮 / 缩略图 / 上传控件
  const hasUploadBtn = !!document.querySelector('.lg-inline-btn, .lg-upload-btn');
  const hasThumb = !!document.querySelector('.lg-image-widget, .lg-dom-widget.lg-image-widget');
  const domWidgets = [...document.querySelectorAll('.lg-dom-widget')].map(w => w.textContent || '').slice(0, 6);
  return { hasUploadBtn, hasThumb, domWidgets }
})()`)
console.log('画布上的加载图像节点：上传按钮=', nodeInfo.hasUploadBtn, '缩略图=', nodeInfo.hasThumb)
console.log('控件文本样例=', JSON.stringify(nodeInfo.domWidgets))
await shot('v03-加载图像节点-带上传.png')

// 4. 打开工作流侧栏（悬浮 + 名称样式）
await evaluate(`(() => {
  const b = document.querySelector('[data-tip="打开工作流"]');
  if (b) b.click();
  return true
})()`)
await sleep(1500)
await shot('v04-打开工作流侧栏.png')

console.log('✅ 验证截图完成：', OUT)
ws.close()
proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(0)
