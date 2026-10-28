/**
 * 全量节点构造冒烟测试 + 示例工作流加载检查
 */
import { spawn } from 'child_process';
import os from 'os'; import path from 'path'; import crypto from 'crypto';
import fs from 'fs';
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'probe3-' + crypto.randomBytes(4).toString('hex'));
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1600,1000','about:blank'], { stdio:'ignore', windowsHide:true });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let ws, id=0; const waiters=new Map();
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((res,rej)=>{waiters.set(i,{res,rej});setTimeout(()=>{if(waiters.has(i)){waiters.delete(i);rej(new Error(m+' timeout'))}},120000)})};

async function main(){
  let page;
  for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const j=await r.json();page=j.find(t=>t.type==='page');if(page)break}catch{}await sleep(300)}
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)});
  const errors=[];
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&waiters.has(m.id)){const w=waiters.get(m.id);waiters.delete(m.id);m.error?w.rej(new Error(JSON.stringify(m.error))):w.res(m.result)}
    if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error'){errors.push((m.params.args||[]).map(a=>String(a.value??a.description??'')).join(' ').slice(0,200))}});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5173'}); await sleep(7000);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return 'EXC: '+JSON.stringify(r.exceptionDetails).slice(0,400);return r.result&&r.result.value};

  // --- 1. 全量构造 ---
  const smoke = await ev(`(async()=>{
    const info = await (await fetch('/object_info')).json();
    const G = window.__comfyGraph;
    const fail = [];
    let ok = 0;
    for (const type of Object.keys(info)) {
      try {
        const n = G.addNode(type, [0,0]);
        if (!n) { fail.push({type, why:'createNode 返回 null'}); continue }
        if (n.has_errors) { fail.push({type, why:'has_errors'}); continue }
        ok++;
      } catch(e) { fail.push({type, why:String(e && e.message || e)}) }
    }
    G.graph.clear();
    return JSON.stringify({total:Object.keys(info).length, ok, fail});
  })()`);
  console.log('=== 全量节点构造 ===');
  console.log(smoke);

  // --- 2. 官方节点中文名 ---
  const names = await ev(`(async()=>{const info=await (await fetch('/object_info')).json();return JSON.stringify(['LoadImage','PreviewImage','SaveImage','ImageScale','EmptyImage','PrimitiveFloat','TextDisplay','NumberDisplay'].map(k=>k+' -> '+(info[k]&&info[k].display_name)))})()`);
  console.log('display_name:', names);

  // --- 3. 载入示例 ---
  const json = JSON.parse(fs.readFileSync('public/examples/04-三链合一.json','utf8'));
  await ev(`(()=>{window.__comfyGraph.loadWorkflow(${JSON.stringify(json)});return 1})()`);
  await sleep(1500);
  console.log('=== 示例节点 ===');
  console.log(await ev(`JSON.stringify(Object.values(window.__comfyGraph.graph._nodes).map(n=>({id:n.id,type:n.type,title:n.title,ctor:n.constructor&&n.constructor.name,err:!!n.has_errors,w:(n.widgets||[]).length,outs:(n.outputs||[]).length,inps:(n.inputs||[]).length})))`));

  console.log('=== 控制台 error ===');
  console.log(errors.length ? errors.join('\n') : '(无)');
  ws.close(); edge.kill(); process.exit(0);
}
main().catch(e=>{console.error(e);try{edge.kill()}catch{}process.exit(1)});
