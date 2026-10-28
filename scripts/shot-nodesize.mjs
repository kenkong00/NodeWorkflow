/**
 * 验证新拖入节点的默认尺寸：截取节点库 + 刚拖入的节点，并打印 size。
 * 用法：node scripts/shot-nodesize.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = process.env.SHOT_URL || 'http://127.0.0.1:5173/'
const PORT = 9334
const OUT = path.resolve(process.cwd(), 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-shot-'))
const proc = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-component-update',
  '--disable-background-networking',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,900',
  'about:blank'
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
    } catch { /* 还没起来 */ }
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
async function click(selector) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('找不到 ' + ${JSON.stringify(selector)}); el.click(); return true })()`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(9000)

// 先添加一个图像加载节点，再添加一个文本节点
async function addNodeByText(pattern) {
  return await evaluate(`(() => {
    const items = [...document.querySelectorAll('.node-item')]
    const item = items.find(e => ${pattern}.test(e.textContent || e.title || ''))
    if (!item) throw new Error('找不到节点项')
    item.click()
    return item.textContent.trim()
  })()`)
}

// 分别验证两种节点：环境变量 NODE_TYPE=loadimage 或 text
const type = process.env.NODE_TYPE || 'loadimage'
const pattern = type === 'text' ? '/文本输入|CLIPTextEncode/i' : '/加载图像|LoadImage/i'
const shotName = type === 'text' ? '06-文本节点尺寸.png' : '06-图像节点尺寸.png'
await addNodeByText(pattern)
await sleep(1200)

const diag = await evaluate(`(() => {
  const canvases = [...document.querySelectorAll('canvas')].map(c => ({
    cls: c.className,
    lgraphcanvas: !!c.lgraphcanvas,
    graph: !!c.graph,
    keys: Object.keys(c).filter(k => /graph|canvas/i.test(k))
  }))
  return canvases
})()`)
console.log('🎨 canvas 诊断:', JSON.stringify(diag, null, 2))

const sizes = await evaluate(`(() => {
  const canvas = [...document.querySelectorAll('canvas')].find(c => c.lgraphcanvas)
  const graph = canvas?.lgraphcanvas?.graph || canvas?.graph
  const nodes = graph?._nodes ? (Array.isArray(graph._nodes) ? graph._nodes : Object.values(graph._nodes)) : []
  return nodes.map(n => ({ id: n.id, type: n.type, size: n.size, pos: n.pos }))
})()`)
console.log('🧱 节点尺寸:', JSON.stringify(sizes, null, 2))

await shot(shotName)
console.log('✅ 截图完成:', OUT)
ws.close()
proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(0)
