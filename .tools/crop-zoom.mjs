// 把本地图片按裁剪区域放大保存（用 Edge 打开 file:// 再 clip 截图）
import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9940 + Math.floor(Math.random() * 15)
const profile = path.join(os.tmpdir(), 'cz' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, id = 0; const W = new Map()
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => { W.set(i, { res, rej }); setTimeout(() => W.has(i) && (W.delete(i), rej(new Error(m))), 30000) }) }
let page
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find((t) => t.type === 'page'); if (page) break } catch { } await sleep(300) }
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && W.has(m.id)) { const w = W.get(m.id); W.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) } })
await send('Page.enable'); await send('Runtime.enable')
const src = process.argv[2]
const [cx, cy, cw, ch, scale, out] = process.argv.slice(3)
const url = 'file:///' + src.replace(/\\/g, '/')
await send('Page.navigate', { url })
await sleep(1500)
const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: +cx, y: +cy, width: +cw, height: +ch, scale: +scale }, captureBeyondViewport: true })
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(r.data, 'base64'))
console.log('saved', out)
ws.close(); edge.kill()
