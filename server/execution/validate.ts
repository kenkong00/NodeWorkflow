/**
 * 执行前校验 —— 复刻 ComfyUI execution.py validate_prompt / validate_inputs
 * 规则（逐条对应源码）：
 *  1. 每个节点必须有 class_type 且注册表中存在；
 *  2. 找出 OUTPUT_NODE 节点；没有 → prompt_no_outputs；
 *  3. 从输出节点递归向上校验：required 缺失、连线类型不符、值域越界、类型强转；
 *  4. 错误按节点归类（node_errors），上游失败下游不重复报错。
 */
import type { NodeRegistry } from '../registry'
import type { NodeDef } from '../registry/types'

export interface PromptNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

export type Prompt = Record<string, PromptNode>

export interface NodeError {
  errors: Array<{ type: string; message: string; details: string }>
  dependent_outputs: string[]
  class_type: string
}

export interface ValidateResult {
  valid: boolean
  error: { type: string; message: string; details: string } | null
  good_outputs: string[]
  node_errors: Record<string, NodeError>
}

/** 复刻 comfy_execution/validation.py validate_node_input */
export function validateNodeInput(receivedType: string, inputType: string): boolean {
  if (receivedType === inputType) return true
  if (receivedType === '*' || inputType === '*') return true
  if (receivedType === 'MATCHTYPE' || inputType === 'MATCHTYPE') return true
  const received = new Set(receivedType.split(',').map((t) => t.trim()))
  const input = new Set(inputType.split(',').map((t) => t.trim()))
  if (received.has('*') || input.has('*')) return true
  return received.size > 0 && [...received].some((t) => input.has(t))
}

function getInputSpec(def: NodeDef, name: string): [string, Record<string, unknown>] | null {
  const groups = def.input || {}
  for (const key of ['required', 'optional'] as const) {
    const g = groups[key]
    if (g && name in g) {
      const spec = g[name] as unknown as [string, Record<string, unknown>]
      return [spec[0] as string, spec[1] || {}]
    }
  }
  return null
}

export function isRequiredInput(def: NodeDef, name: string): boolean {
  return !!def.input?.required && name in def.input.required
}

export class PromptValidator {
  registry: NodeRegistry
  constructor(registry: NodeRegistry) {
    this.registry = registry
  }

  validate(prompt: Prompt): ValidateResult {
    const outputs = new Set<string>()
    for (const [id, node] of Object.entries(prompt)) {
      if (!node || !node.class_type) {
        return {
          valid: false,
          error: { type: 'invalid_prompt', message: '节点缺少 class_type', details: `节点 #${id}` },
          good_outputs: [],
          node_errors: {}
        }
      }
      const def = this.registry.getDef(node.class_type)
      if (!def) {
        return {
          valid: false,
          error: { type: 'invalid_prompt', message: `节点类型不存在: ${node.class_type}`, details: `节点 #${id}` },
          good_outputs: [],
          node_errors: {}
        }
      }
      if (def.output_node) outputs.add(id)
    }
    if (outputs.size === 0) {
      return {
        valid: false,
        error: { type: 'prompt_no_outputs', message: '工作流没有输出节点', details: '' },
        good_outputs: [],
        node_errors: {}
      }
    }

    const goodOutputs = new Set<string>()
    const errors: Array<[string, Array<{ type: string; message: string; details: string }>]> = []
    const nodeErrors: Record<string, NodeError> = {}
    const validated = new Map<string, [boolean, Array<{ type: string; message: string; details: string }>]>()

    for (const o of outputs) {
      const [valid, reasons] = this.validateInputs(prompt, o, validated)
      if (valid) goodOutputs.add(o)
      else {
        errors.push([o, reasons])
        for (const [nodeId, result] of validated) {
          const [v, rs] = result
          if (v !== true && rs.length > 0) {
            if (!nodeErrors[nodeId]) {
              nodeErrors[nodeId] = { errors: rs, dependent_outputs: [], class_type: prompt[nodeId].class_type }
            }
            nodeErrors[nodeId].dependent_outputs.push(o)
          }
        }
      }
    }

    if (goodOutputs.size === 0) {
      const details = errors.map(([, rs]) => rs.map((r) => `${r.message}: ${r.details}`).join('\n')).join('\n')
      return {
        valid: false,
        error: { type: 'prompt_outputs_failed_validation', message: '工作流校验失败', details },
        good_outputs: [],
        node_errors: nodeErrors
      }
    }
    return { valid: true, error: null, good_outputs: [...goodOutputs], node_errors: nodeErrors }
  }

  /** 递归校验单节点（含上游） */
  validateInputs(
    prompt: Prompt,
    id: string,
    validated: Map<string, [boolean, Array<{ type: string; message: string; details: string }>]>
  ): [boolean, Array<{ type: string; message: string; details: string }>] {
    const cached = validated.get(id)
    if (cached) return cached

    // 先占位（对应 ComfyUI validation.py 的 validated[unique_id] = [False]）：
    // 环上递归回来时直接取占位值，交由 ExecutionList.ensureNoDeadlock 报 DependencyCycleError
    validated.set(id, [true, []])

    const node = prompt[id]
    const def = this.registry.getDef(node.class_type)!
    const errors: Array<{ type: string; message: string; details: string }> = []
    const inputs = node.inputs || {}

    const validNames = new Set([
      ...Object.keys(def.input?.required || {}),
      ...Object.keys(def.input?.optional || {})
    ])

    for (const name of validNames) {
      const spec = getInputSpec(def, name)
      if (!spec) continue
      const [inputType, cfg] = spec
      if (!(name in inputs)) {
        if (isRequiredInput(def, name)) {
          errors.push({ type: 'required_input_missing', message: '缺少必填输入', details: name })
        }
        continue
      }
      const val = inputs[name]
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string') {
        // 连线输入
        const oId = val[0]
        const oSlot = val[1] as number
        const oNode = prompt[oId]
        if (!oNode) {
          errors.push({ type: 'bad_linked_input', message: '连线指向不存在的节点', details: name })
          continue
        }
        const oDef = this.registry.getDef(oNode.class_type)
        if (!oDef) {
          errors.push({ type: 'bad_linked_input', message: '连线上游节点类型不存在', details: name })
          continue
        }
        const receivedType = oDef.output[oSlot] ?? '*'
        if (!validateNodeInput(receivedType, inputType as string)) {
          errors.push({
            type: 'return_type_mismatch',
            message: '连线类型不匹配',
            details: `${name}: 上游输出 ${receivedType} ≠ 期望 ${inputType}`
          })
          continue
        }
        const [upValid] = this.validateInputs(prompt, oId, validated)
        if (!upValid) {
          // 上游失败：本节点标 invalid 但不附错误（与 ComfyUI 一致）
          validated.set(id, [false, []])
          return [false, []]
        }
      } else {
        // 字面量：类型强转 + 值域
        try {
          let v: unknown = val
          if (typeof val === 'object' && val !== null && '__value__' in (val as any)) v = (val as any).__value__
          if (inputType === 'INT') v = Math.trunc(Number(v))
          if (inputType === 'FLOAT') v = Number(v)
          if (inputType === 'STRING') v = String(v)
          if (inputType === 'BOOLEAN') v = Boolean(v)
          inputs[name] = v
          if (typeof v === 'number' && Number.isFinite(v)) {
            if (cfg.min !== undefined && v < (cfg.min as number)) {
              errors.push({ type: 'value_smaller_than_min', message: '数值小于最小值', details: `${name}: ${v} < ${cfg.min}` })
              continue
            }
            if (cfg.max !== undefined && v > (cfg.max as number)) {
              errors.push({ type: 'value_bigger_than_max', message: '数值大于最大值', details: `${name}: ${v} > ${cfg.max}` })
              continue
            }
          }
        } catch {
          errors.push({ type: 'invalid_input_type', message: `无法转换为 ${inputType}`, details: name })
          continue
        }
      }
    }

    const result: [boolean, Array<{ type: string; message: string; details: string }>] = [errors.length === 0, errors]
    validated.set(id, result)
    return result
  }
}
