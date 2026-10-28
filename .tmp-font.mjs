import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE='C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT=9990+Math.floor(Math.random()*8)
const profile=path.join(os.tmpdir(),'fx'+crypto.randomBytes(4).toString('hex'))
spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1500,900','about:blank'],{stdio:'ignore',windowsHide:true})
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
let ws,id=0;const W=new Map()
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{W.set(i,{res,rej});setTimeout(()=>W.has(i)&&(W.delete(i),rej(new Error(m))),30000)})}
let page
for(let i=0;i<60;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&W.has(m.id)){const w=W.get(m.id);W.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}})
await send('Page.enable');await send('Runtime.enable')
await send('Page.navigate',{url:'http://127.0.0.1:5173'})
await sleep(8000)
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?'EXC '+JSON.stringify(r.exceptionDetails.exception?.description):r.result.value}
console.log(await ev(`JSON.stringify((()=>{
  const c=window.__comfyGraph.canvas, ctx=c.ctx
  const m=(f)=>{ctx.save();ctx.font=f;const w=ctx.measureText('IMAGE').width;ctx.restore();return Math.round(w*100)/100}
  return {
    inner:c.inner_text_font, title:c.title_text_font, nowFont:ctx.font,
    w_inner:m(c.inner_text_font), w_12:m('normal 12px Arial'), w_125:m('normal 12.5px Arial'), w_14:m('normal 14px Arial'), w_15:m('normal 15px Arial'),
    letterSpacing: (ctx.letterSpacing||''), dpr: c.canvas.width / c.canvas.getBoundingClientRect().width
  }
})())`))
process.exit(0)
