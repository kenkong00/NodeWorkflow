import { spawn } from 'child_process'
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'
const EDGE='C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT=9910+Math.floor(Math.random()*8)
const profile=path.join(os.tmpdir(),'pf'+crypto.randomBytes(4).toString('hex'))
const edge=spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1500,900','about:blank'],{stdio:'ignore',windowsHide:true})
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
let ws,id=0;const W=new Map()
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{W.set(i,{res,rej});setTimeout(()=>W.has(i)&&(W.delete(i),rej(new Error(m))),30000)})}
let page
for(let i=0;i<60;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&W.has(m.id)){const w=W.get(m.id);W.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}})
await send('Page.enable');await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false})
await send('Page.navigate',{url:'http://127.0.0.1:5173'})
await sleep(9000)
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?'EXC '+JSON.stringify(r.exceptionDetails.exception?.description):r.result.value}
await ev(`(()=>{const g=window.__comfyGraph;g.graph.clear();const n=g.addNode('LoadImage',[60,60]);n.setSize([430,200]);g.refitNodeHeight(n);const c=g.canvas;c.ds.scale=1;c.ds.offset[0]=0;c.ds.offset[1]=0;c.setDirty(true,true);return 1})()`)
await sleep(1200)
console.log(await ev(`JSON.stringify((()=>{
  const g=window.__comfyGraph,c=g.canvas,ctx=c.ctx
  const n=Object.values(g.graph._nodes)[0]
  const cr=c.canvas.getBoundingClientRect()
  const dpr=c.canvas.width/cr.width, s=c.ds.scale, o=c.ds.offset
  const rows=(n.widgets||[]).map(w=>{const el=w.element;if(!el)return null;const b=el.getBoundingClientRect();return {name:w.name,type:w.type,left:Math.round(b.left),right:Math.round(b.right),w:Math.round(b.width)}}).filter(Boolean)
  const rowRight=Math.max(...rows.map(r=>r.right))
  const pos=n.getConnectionPos(false,0)
  const slotY=cr.top+(pos[1]+o[1])*s
  const nodeRight=cr.left+(n.pos[0]+n.size[0]+o[0])*s
  const y0=Math.round((slotY-cr.top-5)*dpr),y1=Math.round((slotY-cr.top+6)*dpr)
  const x0=Math.round((rowRight-cr.left-8)*dpr),x1=Math.round((nodeRight-cr.left+3)*dpr)
  const wpx=x1-x0, img=ctx.getImageData(x0,y0,wpx,Math.max(1,y1-y0)).data
  const prof=[]
  for(let x=0;x<wpx;x++){let mx=0
    for(let y=0;y<(y1-y0);y++){const i=(y*wpx+x)*4;const lum=0.299*img[i]+0.587*img[i+1]+0.114*img[i+2];if(lum>mx)mx=lum}
    prof.push({x:Math.round((rowRight-8+x/dpr)*10)/10,lum:Math.round(mx)})
  }
  return {rows,rowRight:Math.round(rowRight),nodeRight:Math.round(nodeRight),slotY:Math.round(slotY),prof}
})())`))
process.exit(0)
