/** 基础 primitive / reroute 节点（原生实现） */
import type { ExecContext, NativeNodeImpl, NodeOutput } from '../registry/types'

function out(v: unknown): NodeOutput {
  return { result: [v] }
}

/**
 * 单输入值节点通用实现
 * 覆盖 TextInput(text) / PromptRule(rule) / PrimitiveString(value)：
 * 均为「一个输入控件 → 原样输出」，优先取语义化字段，其次取第一个输入值。
 */
export const primitiveImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    for (const key of ['value', 'text', 'rule', 'string']) {
      if (key in ctx.inputs) return out(ctx.inputs[key])
    }
    const vals = Object.values(ctx.inputs)
    return out(vals.length > 0 ? vals[0] : null)
  }
}

/** Primitive：按 type 把控件里的字符串强转成 数值/字符串/布尔 */
export const primitiveTypedImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => {
    const type = String(ctx.inputs.type ?? 'number')
    const raw = ctx.inputs.value
    if (type === 'number') {
      const n = Number(raw)
      if (Number.isNaN(n)) throw new Error(`无法把「${String(raw)}」转成数字`)
      return out(n)
    }
    if (type === 'boolean') return out(raw === true || raw === 'true' || raw === 1 || raw === '1')
    return out(raw == null ? '' : String(raw))
  }
}

/** Reroute 中转节点：透传 */
export const rerouteImpl: NativeNodeImpl = {
  execute: (ctx: ExecContext) => out(ctx.inputs[''] ?? Object.values(ctx.inputs)[0])
}

export const nativePrimitiveDefs = [
  {
    name: 'PrimitiveNode',
    def: {
      input: {
        required: {
          type: [['number', 'string', 'boolean'], { default: 'number' }],
          value: ['STRING', { default: '0' }]
        }
      },
      output: ['*'],
      output_name: ['*'],
      name: 'PrimitiveNode',
      display_name: '基础值',
      description: '输出一个基础值（数字/文本/布尔），可被任何输入端口连接。',
      python_module: 'native.primitives',
      category: 'utils/primitive',
      output_node: false
    }
  },
  {
    name: 'Reroute',
    def: {
      input: { required: { '': ['*', {}] } },
      output: ['*'],
      output_name: [''],
      name: 'Reroute',
      display_name: 'Reroute',
      description: '中转节点：原样透传输入。',
      python_module: 'native.primitives',
      category: 'utils/primitive',
      output_node: false
    }
  }
]
