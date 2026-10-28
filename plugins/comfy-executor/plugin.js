/**
 * comfy-executor —— ComfyUI 委托执行器（内置插件）
 *
 * 作用：新系统原生引擎无法执行的节点（MODEL/LATENT/CLIP 等扩散模型节点），
 * 整体转发到真实 ComfyUI（默认 http://127.0.0.1:8188）执行，事件原路转播。
 *
 * 机制（与 ComfyUI 完全同构）：
 *  1. POST /prompt（prompt 格式与 ComfyUI 一致，直接透传）
 *  2. WS /ws?clientId=... 接收 executing/progress/executed 事件并转发
 *  3. /history 兜底轮询；/interrupt 中断
 *  4. 图像引用加 source=comfy，前端 /view 代理拉取
 */

/** @type {import('../../server/execution/engine').ExecutorPlugin} */
const executor = {
  id: 'comfy',
  name: 'ComfyUI 执行器',

  /**
   * 只在「存在无原生实现的节点」时接管（例如 CheckpointLoader/KSampler 等扩散模型节点）。
   * 之前恒返回 true，导致纯本地节点的工作流（文本/数值/图像尺寸计算）也被整体转发到
   * ComfyUI —— ComfyUI 没开就必然报「无法连接 ComfyUI」。这是"运行不了"的根因。
   */
  canExecute(prompt, registry) {
    if (!registry || typeof registry.hasNativeImpl !== 'function') return false
    return Object.values(prompt).some((n) => !registry.hasNativeImpl(n.class_type))
  },

  async execute(prompt, events, opts) {
    const cfg = host.getComfyConfig()
    if (!cfg || !cfg.url) {
      events.onExecutionError?.({
        prompt_id: opts.promptId,
        exception_message: '未配置 ComfyUI 连接：请在「设置 → ComfyUI 连接」中添加并启用（如 http://127.0.0.1:8188）'
      })
      return new Map()
    }

    const base = cfg.url.replace(/\/+$/, '')
    const clientId = `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    // 1. 提交 prompt
    let submitRes
    try {
      submitRes = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: clientId })
      })
    } catch (e) {
      events.onExecutionError?.({
        prompt_id: opts.promptId,
        exception_message: `无法连接 ComfyUI (${base})：${e.message}`
      })
      return new Map()
    }
    const submitData = await submitRes.json()
    if (!submitRes.ok || submitData.error) {
      const details = submitData.node_errors
        ? Object.entries(submitData.node_errors)
            .map(([id, ne]) => `节点 ${id} (${ne.class_type}): ${ne.errors.map((x) => `${x.message} ${x.details}`).join('; ')}`)
            .join('\n')
        : JSON.stringify(submitData)
      events.onExecutionError?.({ prompt_id: opts.promptId, exception_message: `ComfyUI 拒绝执行：${details}` })
      return new Map()
    }
    const comfyPromptId = submitData.prompt_id

    events.onExecutionStart?.({ prompt_id: opts.promptId })
    events.onExecuting?.({ node: null, prompt_id: opts.promptId })

    // 2. WebSocket 事件转发
    const outputs = new Map()
    await new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        try { ws.close() } catch {}
        clearInterval(pollTimer)
        resolve()
      }

      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`)
      ws.onmessage = (ev) => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        const d = msg.data || {}
        switch (msg.type) {
          case 'execution_start':
            break
          case 'executing':
            if (d.node == null) {
              // 全部执行完
              events.onStatus?.({ status: 'success', completed: true })
              finish()
            } else {
              events.onExecuting?.({ node: String(d.node), prompt_id: opts.promptId })
            }
            break
          case 'progress':
            events.onProgress?.({ node: String(d.node), value: d.value, max: d.max, prompt_id: opts.promptId })
            break
          case 'executed': {
            const ui = withProxySource(d.output)
            outputs.set(String(d.node), ui)
            events.onExecuted?.({ node: String(d.node), output: ui, prompt_id: opts.promptId })
            break
          }
          case 'execution_error':
            events.onExecutionError?.({
              prompt_id: opts.promptId,
              node_id: d.node_id != null ? String(d.node_id) : undefined,
              exception_message: `ComfyUI 执行错误：${d.exception_message || '未知错误'}`
            })
            finish()
            break
          case 'execution_interrupted':
            events.onStatus?.({ status: 'interrupted' })
            finish()
            break
          case 'status':
            if (d.status?.exec_info?.queue_remaining === 0 && outputs.size > 0) {
              // 兜底：队列已空
              setTimeout(finish, 800)
            }
            break
        }
      }
      ws.onerror = () => { /* 靠轮询兜底 */ }
      ws.onclose = () => setTimeout(finish, 1500)

      // 3. 轮询兜底（WS 断开时也能拿到结果）
      const pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${base}/history/${comfyPromptId}`)
          const hist = await res.json()
          const entry = hist[comfyPromptId]
          if (entry && (entry.status?.completed || entry.status?.status === 'success')) {
            if (entry.outputs) {
              for (const [nodeId, out] of Object.entries(entry.outputs)) {
                if (!outputs.has(String(nodeId))) {
                  const ui = withProxySource(out)
                  outputs.set(String(nodeId), ui)
                  events.onExecuted?.({ node: String(nodeId), output: ui, prompt_id: opts.promptId })
                }
              }
            }
            if (entry.status?.status_str === 'error') {
              events.onExecutionError?.({
                prompt_id: opts.promptId,
                exception_message: 'ComfyUI 执行失败（详见 ComfyUI 控制台）'
              })
            }
            finish()
          }
        } catch { /* 忽略 */ }
        if (opts.cancelled()) finish()
      }, 1000)

      // 中断监听
      const interruptCheck = setInterval(() => {
        if (opts.cancelled()) {
          fetch(`${base}/interrupt`, { method: 'POST' }).catch(() => {})
          clearInterval(interruptCheck)
        }
      }, 500)
    })

    return outputs
  }
}

/** 给 ComfyUI 图像引用加 source=comfy，前端 /view 代理拉取 */
function withProxySource(output) {
  if (!output || typeof output !== 'object') return output
  const clone = Array.isArray(output) ? [...output] : { ...output }
  for (const key of ['images', 'animated', 'audio', 'files', '3d', 'text']) {
    if (Array.isArray(clone[key])) {
      clone[key] = clone[key].map((item) =>
        item && typeof item === 'object' && 'filename' in item ? { source: 'comfy', ...item } : item
      )
    }
  }
  return clone
}

/** 宿主上下文（由插件加载器注入） */
const host = {
  getComfyConfig: () => ({ url: '' })
}

export function init(hostCtx) {
  Object.assign(host, hostCtx)
}

export const EXECUTORS = [executor]
