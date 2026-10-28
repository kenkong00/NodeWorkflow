/**
 * 打开「设置 → API 服务商」，验证状态灯与启用按钮禁用逻辑。
 * 用法：SHOT_URL=http://127.0.0.1:5173/ node scripts/shot-settings.mjs
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
async function click(sel) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('找不到 ' + ${JSON.stringify(sel)}); el.click(); return true })()`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(9000)

// 打开设置
await click('[data-tip="设置"]')
await sleep(1200)

// 切到 API 服务商
await evaluate(`(() => {
  const items = [...document.querySelectorAll('.st-nav-item')]
  const t = items.find(e => /API 服务商/i.test(e.textContent || ''))
  if (!t) throw new Error('找不到 API 服务商 分区')
  t.click()
  return true
})()`)
await sleep(2500)

await shot('settings-llm.png')

// 读取列表状态 + 启用按钮禁用情况
const info = await evaluate(`(() => {
  const list = [...document.querySelectorAll('.st-list .st-item')].map(el => {
    const dot = el.querySelector('.st-dot')
    const tag = el.querySelector('.st-tag')
    return {
      name: (el.querySelector('.st-item-name')?.textContent || '').trim(),
      status: dot ? [...dot.classList].filter(c => c !== 'st-dot').join(',') || 'unknown' : 'unknown',
      enabled: !!tag
    }
  })
  // 选中第一项，看启用按钮 disabled
  const first = document.querySelector('.st-list .st-item')
  if (first) first.click()
  const enableBtn = [...document.querySelectorAll('.detail-foot .btn')].find(b => /启用|停用/.test(b.textContent || ''))
  return {
    list,
    selectedEnableDisabled: enableBtn ? enableBtn.disabled : null,
    selectedEnableLabel: enableBtn ? (enableBtn.textContent || '').trim() : null
  }
})()`)
console.log('🔎 API 服务商状态:', JSON.stringify(info, null, 2))

await sleep(800)
await shot('settings-llm-selected.png')

console.log('✅ 完成：', OUT)
ws.close()
proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(0)
