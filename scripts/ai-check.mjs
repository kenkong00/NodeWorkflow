/**
 * 只验证一件事：AI 面板里选 OpenRouter 后，能不能真的收到回复。
 * 用法：node scripts/ai-check.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = process.env.SHOT_URL || 'http://127.0.0.1:5174/'
const PORT = 9335
const OUT = path.resolve(process.cwd(), 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-ai-'))
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-component-update', '--disable-background-networking',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1600,900', 'about:blank'
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (r.ok) {
        const p = (await r.json()).find((t) => t.type === 'page')
        if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
      }
    } catch { /* noop */ }
    await sleep(500)
  }
  throw new Error('CDP 端点未就绪')
}
const ws = new WebSocket(await waitEndpoint())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
function send(method, params = {}) {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')) } }, 90000)
  })
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(9000)

await ev(`(() => { document.querySelector('.ai-btn').click(); return true })()`)
await sleep(2500)

// 切到 OpenRouter
console.log('切换供应商:', await ev(`(() => {
  const p = document.querySelectorAll('.ai-head select')[0];
  const opt = [...p.options].find(o => /openrouter/i.test(o.text));
  if (!opt) return 'NO_OPTION';
  p.value = opt.value; p.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.text;
})()`))
await sleep(2500)

// 输入 + 点发送按钮
const MSG = process.env.MSG || '只回复四个字：联通成功'
await ev(`(() => {
  const ta = document.querySelector('textarea.ac-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(MSG)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return ta.value;
})()`)
await sleep(500)
console.log('点发送:', await ev(`(() => {
  const b = document.querySelector('.ac-send');
  if (!b) return 'NO_SEND_BTN';
  if (b.disabled) return 'DISABLED';
  b.click(); return 'clicked';
})()`))

// 轮询面板文本（每秒打一次，最多 40s）
let finalText = ''
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  const st = await ev(`(() => {
    const body = document.querySelector('.ai-body');
    const msgs = [...document.querySelectorAll('.ai-msg')].map(m => (m.innerText || '').replace(/\\n+/g, ' '));
    const lastEl = [...document.querySelectorAll('.ai-msg')].pop();
    return {
      count: msgs.length,
      last: msgs[msgs.length - 1] || '',
      html: lastEl ? lastEl.innerHTML.slice(0, 500) : '',
      steps: [...document.querySelectorAll('.am-step-name')].map(e => e.textContent).join(' / '),
      amError: document.querySelector('.am-error')?.textContent || '',
      text: body ? body.innerText.replace(/\\n+/g, ' | ').slice(0, 400) : '',
      err: document.querySelector('.ai-err')?.textContent || '',
      stop: !!document.querySelector('.ac-stop')
    }
  })()`)
  if (i % 2 === 1 || st.err) console.log(`[${i + 1}s] 消息数=${st.count} 生成中=${st.stop} 面板错误=${st.err || '无'} 消息内错误=${st.amError || '无'}`)
  if (st.steps) console.log(`      调用的工具: ${st.steps}`)
  if (st.last) console.log(`      助手最后一条: ${JSON.stringify(st.last.slice(0, 200))}`)
  if (!st.last && st.count >= 2 && i % 4 === 3) console.log(`      助手消息 HTML: ${JSON.stringify(st.html.slice(200, 420))}`)
  finalText = st.text
  if (!st.stop && st.count >= 2 && i >= 14) break
}
console.log('最终面板文本:', JSON.stringify(finalText.slice(0, 400)))
await sleep(1000)
await shot('ai-check-结果.png')
ws.close()
proc.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* noop */ }
process.exit(0)
