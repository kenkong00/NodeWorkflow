import { spawn } from 'child_process';
import os from 'os'; import path from 'path'; import crypto from 'crypto';
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'probe-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1600,1000','about:blank'], { stdio:'ignore', windowsHide:true });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let ws, id=0; const waiters=new Map();
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{waiters.set(i,{res,rej});setTimeout(()=>{if(waiters.has(i)){waiters.delete(i);rej(new Error(m+' timeout'))}},60000)})};
async function main(){
  let page;
  for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const j=await r.json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&waiters.has(m.id)){const w=waiters.get(m.id);waiters.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5173'}); await sleep(8000);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return 'EXC: '+JSON.stringify(r.exceptionDetails).slice(0,300);return r.result&&r.result.value};
  console.log('registry title:', await ev(`JSON.stringify((()=>{const T=window.__comfyGraph; const c=T.graph._nodes; return Object.keys(c).length})())`));
  console.log('PreviewImage class title:', await ev(`(()=>{ const m = window.__lg || null; return 'n/a' })()`));
  // 直接加载示例
  const json = JSON.parse((await import('fs')).readFileSync('public/examples/04-三链合一.json','utf8'));
  await ev(`window.__comfyGraph.loadWorkflow(${JSON.stringify(json)})`);
  await sleep(1500);
  const info = await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n=>({id:n.id,type:n.type,title:n.title,ctorTitle:n.constructor&&n.constructor.title,display:(window.__defs||{})[n.type]&&window.__defs[n.type].display_name})))`);
  console.log(info);
  const cls = await ev(`(()=>{ const n = Object.values(window.__comfyGraph.graph._nodes).find(n=>n.type==='PreviewImage'); return JSON.stringify({ctor:n&&n.constructor&&n.constructor.name, title:n&&n.constructor&&n.constructor.title}) })()`);
  console.log('PreviewImage ctor:', cls);
  ws.close(); edge.kill(); process.exit(0);
}
main().catch(e=>{console.error(e);try{edge.kill()}catch{}process.exit(1)});
