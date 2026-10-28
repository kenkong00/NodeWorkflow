/** 队列取消 / 中断 —— 紧凑时序真机验证 */
const API = 'http://127.0.0.1:5173';
const P = (size, title) => ({
  prompt: {
    '1': { class_type: 'EmptyImage', inputs: { width: size, height: size, batch_size: 1, color: 0x2b6cb0 } },
    '2': { class_type: 'ImageBlur', inputs: { image: ['1', 0], blur_radius: 31, sigma: 9 } },
    '3': { class_type: 'ImageBlur', inputs: { image: ['2', 0], blur_radius: 31, sigma: 9 } },
    '4': { class_type: 'ImageBlur', inputs: { image: ['3', 0], blur_radius: 31, sigma: 9 } },
    '5': { class_type: 'PreviewImage', inputs: { images: ['4', 0] } }
  },
  extra_data: { title }
});
const post = async (u, b) => {
  const r = await fetch(API + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (u) => (await fetch(API + u)).json();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };

// 先量一次单任务耗时（5000x5000 三次模糊）
let t = Date.now();
const warm = await post('/prompt', P(5000, '耗时基准'));
for (let i = 0; i < 100; i++) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) break;
  await sleep(100);
}
const dur = (Date.now() - t) / 1000;
console.log(`基准任务耗时 ${dur.toFixed(2)}s（5000x5000 × 3 次模糊）\n`);

console.log('--- 连发 3 个任务，并立刻取消最后一个 ---');
const ids = [];
for (let i = 1; i <= 3; i++) {
  const r = await post('/prompt', P(5000, `取消测试#${i}`));
  ids.push(r.body.prompt_id);
}
const q0 = await get('/queue');
const total0 = q0.running.length + q0.pending.length;
check('提交 3 个任务后队列里有 3 个', total0 === 3, `running=${q0.running.length} pending=${q0.pending.length}`);
check('下拉能拿到每个任务的标题', (q0.running.concat(q0.pending)).every(x => x.title), JSON.stringify((q0.running.concat(q0.pending)).map(x => x.title)));

const r1 = await post('/queue/cancel', { prompt_id: ids[2] });
check('取消排队中的第 3 个任务成功', r1.body.ok === true && r1.body.where === 'pending', JSON.stringify(r1.body));
const q1 = await get('/queue');
check('取消后队列只剩 2 个', q1.running.length + q1.pending.length === 2, `running=${q1.running.length} pending=${q1.pending.length}`);
check('被取消的任务不在队列里', !q1.running.concat(q1.pending).some(x => x.prompt_id === ids[2]));

console.log('\n--- 全部停止（应清空剩余任务并中断正在跑的）---');
const r2 = await post('/interrupt', {});
check('停止接口返回 200', r2.status === 200);
let cleared = false;
for (let i = 0; i < 20; i++) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) { cleared = true; break; }
  await sleep(100);
}
check('停止后队列清空', cleared);
await sleep(600);
const h = await get('/history');
const st = (id) => h[id] && h[id].status;
console.log('  状态：', ids.map((id, i) => `#${i + 1}=${st(id) || '未记录'}`).join(' '));
check('被中断的任务记为 interrupted 或 completed', ['interrupted', 'completed'].includes(st(ids[0])));
check('被取消的排队任务记为 interrupted', st(ids[2]) === 'interrupted', '实际 ' + st(ids[2]));

console.log('\n--- 停止后能否继续跑 ---');
t = Date.now();
const r3 = await post('/prompt', P(512, '恢复验证'));
for (let i = 0; i < 60; i++) {
  const q = await get('/queue');
  if (!q.running.length && !q.pending.length) break;
  await sleep(100);
}
const h2 = await get('/history');
check('中断后引擎仍可执行', h2[r3.body.prompt_id]?.status === 'completed', `耗时 ${((Date.now() - t) / 1000).toFixed(2)}s`);
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
