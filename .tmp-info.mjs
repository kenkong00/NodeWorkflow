import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9960 + Math.floor(Math.random() * 10)
const profile = path.join(os.tmpdir(), 'ci' + crypto.randomBytes(4).toString('hex'))
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1400,900','about:blank'], { stdio:'ignore', windowsHide:true })
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
let ws,id=0;const W=new Map()
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{W.set(i,{res,rej});setTimeout(()=>W.has(i)&&(W.delete(i),rej(new Error(m))),30000)})}
let page
for(let i=0;i<60;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&W.has(m.id)){const w=W.get(m.id);W.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}})
await send('Page.enable');await send('Runtime.enable')
const src=process.argv[2]
await send('Page.navigate',{url:'file:///'+src.replace(/\\/g,'/')})
await sleep(2000)
const r=await send('Runtime.evaluate',{expression:`JSON.stringify((()=>{const i=document.images[0];const b=i.getBoundingClientRect();return {nat:[i.naturalWidth,i.naturalHeight],rect:[b.left,b.top,b.width,b.height],dpr:devicePixelRatio,inner:[innerWidth,innerHeight]}})())`,returnByValue:true})
console.log(r.result.value)
ws.close();edge.kill()
