import { spawn } from 'child_process';
import os from 'os'; import path from 'path'; import crypto from 'crypto';
import fs from 'fs';
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'probe2-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1600,1000','about:blank'], { stdio:'ignore', windowsHide:true });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let ws, id=0; const waiters=new Map();
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{waiters.set(i,{res,rej});setTimeout(()=>{if(waiters.has(i)){waiters.delete(i);rej(new Error(m+' timeout'))}},60000)})};

async function main(){
  let page;
  for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const j=await r.json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&waiters.has(m.id)){const w=waiters.get(m.id);waiters.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}
    if(m.method==='Runtime.consoleAPICalled' && ['error','warning'].includes(m.params.type)){ console.log('  [console.'+m.params.type+']', (m.params.args||[]).map(a=>String(a.value ?? a.description ?? '').slice(0,300)).join(' ')) }
    if(m.method==='Runtime.exceptionThrown'){ console.log('  [exception]', JSON.stringify(m.params.exceptionDetails).slice(0,400)) }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5173'}); await sleep(7000);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return 'EXC: '+JSON.stringify(r.exceptionDetails).slice(0,400);return r.result&&r.result.value};

  console.log('globals:', await ev(`JSON.stringify({g:!!window.__comfyGraph, lg:!!window.LiteGraph, defs:!!window.__defs})`));
  console.log('registered types count:', await ev(`Object.keys(window.LiteGraph.registered_node_types).length`));
  console.log('PreviewImage reg:', await ev(`(()=>{const c=window.LiteGraph.registered_node_types['PreviewImage'];return JSON.stringify({exists:!!c,name:c&&c.name,title:c&&c.title})})()`));
  console.log('createNode test:', await ev(`(()=>{try{const n=window.LiteGraph.createNode('PreviewImage');return JSON.stringify({ok:!!n,ctor:n&&n.constructor&&n.constructor.name,title:n&&n.title,widgets:n&&n.widgets&&n.widgets.length,hasErr:n&&n.has_errors})}catch(e){return 'THROW '+e.message}})()`));

  const json = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json','utf8'));
  console.log('example node types:', json.nodes.map(n=>n.type).join(','));
  await ev(`(()=>{window.__comfyGraph.loadWorkflow(${JSON.stringify(json)});return 1})()`);
  await sleep(1200);
  console.log('nodes after load:', await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n=>({id:n.id,type:n.type,title:n.title,ctor:n.constructor&&n.constructor.name,ctorTitle:n.constructor&&n.constructor.title,err:!!n.has_errors,w:(n.widgets||[]).length})))`));
  ws.close(); edge.kill(); process.exit(0);
}
main().catch(e=>{console.error(e);try{edge.kill()}catch{}process.exit(1)});
