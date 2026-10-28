// MathOp 原生实现单测：6 + 7 = 13，及全部运算
const { mathImpl } = await import('../server/nativeNodes/math.ts')
const run = (op, a, b) => mathImpl.execute({ inputs: { op, a, b }, nodeId: '1' })
const cases = [
  ['add', 6, 7, 13],
  ['sub', 6, 7, -1],
  ['mul', 6, 7, 42],
  ['div', 7, 2, 3.5],
  ['mod', 7, 3, 1],
  ['pow', 2, 10, 1024],
  ['min', 6, 7, 6],
  ['max', 6, 7, 7]
]
let pass = 0
for (const [op, a, b, expect] of cases) {
  const r = run(op, a, b)
  const got = r.result[0]
  const ok = got === expect
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${op}(${a},${b}) = ${got} (expect ${expect})`)
}
console.log(`MathOp: ${pass}/${cases.length} 通过`)
process.exit(pass === cases.length ? 0 : 1)
