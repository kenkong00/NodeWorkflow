/**
 * 打开工作流侧边栏自检：看列表有没有读到目录，以及「新建文件夹」按钮有没有反应。
 * 用法：node scripts/wf-check.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = process.env.SHOT_URL || 'http://127.0.0.1:5174/'
const PORT = 9338
const OUT = path.resolve(process.cwd(), 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-wf-'))
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-component-update', '--disable-background-networking',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (r.ok) { const p = (await r.json()).find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl }
    } catch { /* noop */ }
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}
const ws = new WebSocket(await waitEndpoint())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
const net = []
const errs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return }
  if (m.method === 'Network.responseReceived') {
    const u = m.params.response.url
    if (/\/api\/workflow/.test(u)) net.push(`${m.params.response.status} ${u}`)
  }
  if (m.method === 'Network.loadingFailed') {
    const u = m.params.requestId
    if (m.params.errorText) net.push(`FAILED ${m.params.errorText}`)
    void u
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300))
  }
}
function send(method, params = {}) {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((resolve, reject) => { pending.set(mid, { resolve, reject }); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')) } }, 60000) })
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
  console.log('📷', name)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(9000)

// 切到「打开工作流」面板
await ev(`(() => { const b = document.querySelector('[data-tip="打开工作流"]'); if (!b) throw new Error('找不到打开工作流按钮'); b.click(); return true })()`)
await sleep(2500)

const state = await ev(`(() => {
  const panel = document.querySelector('.wf-panel');
  return {
    panelExists: !!panel,
    count: document.querySelector('.wf-count')?.textContent || '',
    folders: [...document.querySelectorAll('.wf-folder-name, .wf-folder')].map(e => e.textContent.trim()).slice(0, 8),
    files: [...document.querySelectorAll('.wf-file .wf-name')].map(e => e.textContent.trim()),
    empty: document.querySelector('.wf-empty')?.textContent.trim() || '',
    text: panel ? panel.innerText.replace(/\\n+/g, ' | ').slice(0, 300) : ''
  }
})()`)
console.log('面板存在:', state.panelExists, '| 计数:', state.count)
console.log('文件夹:', state.folders)
console.log('工作流:', state.files)
console.log('空状态:', state.empty || '无')
console.log('面板文本:', state.text)
await shot('wf-01-打开工作流面板.png')

// 点「新建文件夹」
console.log('点新建文件夹:', await ev(`(() => {
  const b = [...document.querySelectorAll('.wf-icon')].find(x => /新建文件夹/.test(x.title));
  if (!b) return 'NO_BTN';
  b.click(); return 'clicked';
})()`))
await sleep(1200)
const afterClick = await ev(`(() => {
  const inp = document.querySelector('.wf-newinput');
  return { inputVisible: !!inp, focused: document.activeElement?.className || '' };
})()`)
console.log('输入框出现:', afterClick.inputVisible, '| 当前焦点:', afterClick.focused)

if (afterClick.inputVisible) {
  await ev(`(() => {
    const inp = document.querySelector('.wf-newinput');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '测试新建目录');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true
  })()`)
  await sleep(2000)
  const created = await ev(`(() => ({
    folders: [...document.querySelectorAll('.wf-folder-name, .wf-folder')].map(e => e.textContent.trim()).slice(0, 8),
    text: document.querySelector('.wf-panel')?.innerText.replace(/\\n+/g, ' | ').slice(0, 300) || ''
  }))()`)
  console.log('新建后文件夹列表:', created.folders)
  console.log('新建后面板文本:', created.text)
}
await shot('wf-02-新建文件夹.png')

console.log('相关接口:', net.length ? net : '（没抓到 workflow 接口请求）')
console.log('控制台错误:', errs.length ? errs : '无')
ws.close(); proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* noop */ }
process.exit(0)
