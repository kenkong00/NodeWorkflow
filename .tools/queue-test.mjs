/** 队列 / 多任务 / 取消 —— 后端真机验证 */
const API = 'http://127.0.0.1:5173';
const P = (size, title) => ({
  prompt: {
    '1': { class_type: 'EmptyImage', inputs: { width: size, height: size, batch_size: 1, color: 0x2b6cb0 } },
    '2': { class_type: 'ImageBlur', inputs: { image: ['1', 0], blur_radius: 31, sigma: 9 } },
    '3': { class_type: 'ImageBlur', inputs: { image: ['2', 0], blur_radius: 31, sigma: 9 } },
    '4': { class_type: 'PreviewImage', inputs: { images: ['3', 0] } }
  },
  extra_data: { title }
});
const post = async (u, b) => {
  const r = await fetch(API + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (u) => (await fetch(API + u)).json();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('--- 1. 单任务耗时（3000x3000 两次模糊）---');
let t = Date.now();
const one = await post('/prompt', P(3000, '单任务计时'));
let q1 = await get('/queue');
console.log('提交:', one.status, one.body.prompt_id, '| 立即查询 running/pending =', q1.running.length, '/', q1.pending.length);
while (Date.now() - t < 20000) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) break;
  await sleep(200);
}
console.log('单任务总耗时', ((Date.now() - t) / 1000).toFixed(2) + 's');

console.log('\n--- 2. 连发 3 个任务，观察队列 ---');
const ids = [];
for (let i = 1; i <= 3; i++) {
  const r = await post('/prompt', P(3000, `队列测试#${i}`));
  ids.push(r.body.prompt_id);
}
let maxPend = 0, snap = null;
for (let i = 0; i < 10; i++) {
  const q = await get('/queue');
  if (q.pending.length > maxPend) { maxPend = q.pending.length; snap = q; }
  await sleep(150);
}
console.log('峰值：running', snap?.running.length, 'pending', snap?.pending.length, '| 标题', (snap?.running || []).concat(snap?.pending || []).map(x => x.title));
console.log('队列里能看到 3 个任务 =', (maxPend + (snap?.running.length || 0)) === 3, `(maxPend=${maxPend})`);

console.log('\n--- 3. 取消排队中的第 3 个任务 ---');
const third = ids[2];
const r1 = await post('/queue/cancel', { prompt_id: third });
console.log('cancel ->', JSON.stringify(r1));
const q2 = await get('/queue');
console.log('取消后 running/pending =', q2.running.length, '/', q2.pending.length, '| 列表', (q2.running || []).concat(q2.pending || []).map(x => x.title));

console.log('\n--- 4. 全部停止 ---');
const r2 = await post('/interrupt', {});
console.log('interrupt ->', r2.status);
let cleared = false;
for (let i = 0; i < 12; i++) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) { cleared = true; break; }
  await sleep(200);
}
console.log('队列已清空 =', cleared);

const h = await get('/history');
const st = Object.entries(h).filter(([k]) => ids.includes(k) || k === one.body.prompt_id).map(([k, v]) => `${v.prompt && JSON.stringify(v.prompt).slice(0, 0)}${k.slice(-6)}:${v.status}`);
console.log('本次任务状态:', st.join(' '));

console.log('\n--- 5. 停止后再跑一个轻任务，确认引擎没被卡死 ---');
t = Date.now();
const r3 = await post('/prompt', P(256, '恢复验证'));
for (let i = 0; i < 40; i++) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) break;
  await sleep(150);
}
const h2 = await get('/history');
console.log('恢复任务:', r3.status, h2[r3.body.prompt_id]?.status, '耗时', ((Date.now() - t) / 1000).toFixed(2) + 's');
