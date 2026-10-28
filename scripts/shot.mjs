/**
 * 用本机 Edge（headless）+ CDP 给运行中的项目截图。
 * 用法：node scripts/shot.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = process.env.SHOT_URL || 'http://127.0.0.1:5174/'
const PORT = 9333
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

/** 拿页面级 target 的调试地址（浏览器级端点不支持 Page 域） */
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

// 1. 默认界面（节点库侧栏）
await shot('01-主界面-节点库.png')

// 2. 节点库 image 分类（确认去重）
await evaluate(`(() => {
  const items = [...document.querySelectorAll('.cat-row, .cat-head, .cat-name')];
  const img = items.find(e => /image/i.test(e.textContent || ''));
  if (img) img.click();
  return true
})()`)
await sleep(900)
await shot('02-节点库-image分类.png')

// 3. 打开工作流面板（侧边，非弹窗）
await click('[data-tip="打开工作流"]')
await sleep(1600)
await shot('03-打开工作流侧边面板.png')

// 4. 收起面板 + 打开 AI 助手
await click('[data-tip="打开工作流"]')
await sleep(500)
await click('.ai-btn')
await sleep(1500)
await shot('04-AI对话窗口.png')

// 5. 在 AI 输入框里敲一段多行内容（验证输入框自增高）
await evaluate(`(() => {
  const ta = document.querySelector('.ac-input, .ai-composer textarea, textarea');
  if (!ta) return false;
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '帮我搭一个工作流：\\n1) 加载一张图片\\n2) 预览它\\n3) 再把它保存到 output 目录\\n\\n顺便说明每一步用了什么节点。');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true
})()`)
await sleep(900)
await shot('05-AI输入框自增高.png')

console.log('✅ 截图完成：', OUT)
ws.close()
proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(0)
