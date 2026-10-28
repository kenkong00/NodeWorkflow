/**
 * 示例插件 —— 展示新系统插件机制（与 ComfyUI custom_nodes 同构）
 *
 * 放置位置：plugins/<插件名>/index.js（或 plugin.js）
 * 导出约定：
 *   - NODE_CLASS_MAPPINGS: { 节点名: { def, impl } }   def 为 /object_info V1 schema
 *   - NODE_DISPLAY_NAME_MAPPINGS: { 节点名: 显示名 }（可选）
 *   - WEB_DIRECTORY: 'js'                              前端扩展静态目录（可选，挂载到 /extensions/<插件名>/）
 *   - EXECUTORS: [执行器]                               委托执行器（可选）
 *   - init(host): 接收宿主上下文（可选）
 */

/** 节点实现：文本反转 */
const reverseText = {
  execute: async (ctx) => ({
    result: [String(ctx.inputs.text ?? '').split('').reverse().join('')]
  })
}

export const NODE_CLASS_MAPPINGS = {
  TextReverse: {
    def: {
      input: {
        required: {
          text: ['STRING', { multiline: true, default: '' }]
        }
      },
      output: ['STRING'],
      output_name: ['REVERSED'],
      name: 'TextReverse',
      display_name: '文本反转',
      description: '把输入文本逐字符反转（示例插件）。',
      python_module: 'plugin.example',
      category: 'utils/text',
      output_node: false
    },
    impl: reverseText
  }
}

export const NODE_DISPLAY_NAME_MAPPINGS = {
  TextReverse: '文本反转（示例）'
}

/** 前端扩展示例（挂载到 /extensions/example/example.js） */
export const WEB_DIRECTORY = 'js'

/** 宿主上下文（由加载器注入，可读取 ComfyUI 连接等） */
export function init(host) {
  console.log('[示例插件] 已加载，宿主上下文 keys:', Object.keys(host))
}
