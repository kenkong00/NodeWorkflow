/** 数学运算节点（原生实现） */
import type { ExecContext, NativeNodeImpl, NodeOutput } from '../registry/types'

const OPS: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => (b === 0 ? 0 : a / b),
  mod: (a, b) => (b === 0 ? 0 : a % b),
  pow: (a, b) => a ** b,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b)
}

export const mathImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const op = String(ctx.inputs.op ?? 'add')
    const a = Number(ctx.inputs.a ?? 0)
    const b = Number(ctx.inputs.b ?? 0)
    const fn = OPS[op]
    if (!fn) throw new Error(`不支持的运算: ${op}`)
    const value = fn(a, b)
    return { result: [value] } as NodeOutput
  }
}

export const nativeMathDefs = [
  {
    name: 'MathOp',
    def: {
      input: {
        required: {
          op: [['add', 'sub', 'mul', 'div', 'mod', 'pow', 'min', 'max'], { default: 'add' }],
          a: ['FLOAT', { default: 0 }],
          b: ['FLOAT', { default: 0 }]
        }
      },
      output: ['FLOAT'],
      output_name: ['RESULT'],
      name: 'MathOp',
      display_name: '数学运算',
      description: '两数运算：加减乘除取余幂大小。',
      python_module: 'native.math',
      category: 'utils/math',
      output_node: false
    }
  }
]
