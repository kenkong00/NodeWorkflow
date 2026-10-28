/**
 * 提示词队列 + WebSocket 事件 hub —— 复刻 ComfyUI PromptQueue / server.py
 * 事件类型与 ComfyUI 完全一致：status / execution_start / executing / progress /
 * executed / execution_error / execution_interrupted / execution_cached
 *
 * 扩展（本系统）：
 *  - status 事件附带 running / pending 明细，前端据此渲染「任务下拉、逐个取消」
 *  - cancel(promptId) 可取消排队中的单个任务，或中断正在跑的那个
 */
import type { WebSocket } from 'ws'
import type { Prompt } from './validate'
import { PromptExecutor, type ExecEvents } from './engine'

export interface QueueItem {
  promptId: string
  number: number
  prompt: Prompt
  extraData?: Record<string, unknown>
  submittedAt: number
  /** 任务标签（前端传 extra_data.title，用于下拉里显示是哪个工作流） */
  title?: string
}

interface HistoryEntry {
  prompt: QueueItem
  status: 'completed' | 'error' | 'interrupted'
  outputs?: Record<string, unknown>
  error?: string
  finishedAt: number
}

export type CancelTarget = 'running' | 'pending' | 'not_found'

export class PromptQueue {
  private queue: QueueItem[] = []
  private running = false
  private current: QueueItem | null = null
  private counter = 0
  private cancelledFlag = false
  private clients = new Set<WebSocket>()
  private history = new Map<string, HistoryEntry>()
  private outputsCache = new Map<string, Record<string, unknown>>()

  executor: PromptExecutor
  constructor(executor: PromptExecutor) {
    this.executor = executor
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws)
    this.broadcastStatus()
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws)
  }

  private broadcast(type: string, data: unknown): void {
    const msg = JSON.stringify({ type, data })
    for (const ws of this.clients) {
      if (ws.readyState === 1) ws.send(msg)
    }
  }

  /** 当前队列快照（前端任务下拉用） */
  snapshot(): { running: Array<{ prompt_id: string; number: number; title?: string }>; pending: Array<{ prompt_id: string; number: number; title?: string }> } {
    const brief = (i: QueueItem) => ({ prompt_id: i.promptId, number: i.number, title: i.title })
    return {
      running: this.current ? [brief(this.current)] : [],
      pending: this.queue.map(brief)
    }
  }

  broadcastStatus(): void {
    const snap = this.snapshot()
    this.broadcast('status', {
      status: this.running ? 'running' : 'idle',
      exec_info: { queue_remaining: snap.pending.length },
      running: snap.running,
      pending: snap.pending
    })
  }

  put(prompt: Prompt, extraData?: Record<string, unknown>): QueueItem {
    const meta = (extraData || {}) as { title?: string }
    const item: QueueItem = {
      promptId: `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      number: ++this.counter,
      prompt,
      extraData,
      submittedAt: Date.now(),
      title: meta.title
    }
    this.queue.push(item)
    this.broadcastStatus()
    void this.drain()
    return item
  }

  getQueueInfo() {
    const snap = this.snapshot()
    return {
      queue_running: snap.running.map((i) => [i.number, i.prompt_id]),
      queue_pending: snap.pending.map((i) => [i.number, i.prompt_id]),
      running: snap.running,
      pending: snap.pending
    }
  }

  getHistory() {
    const out: Record<string, unknown> = {}
    for (const [id, h] of this.history) {
      out[id] = {
        prompt: h.prompt.prompt,
        status: h.status,
        outputs: h.outputs,
        error: h.error
      }
    }
    return out
  }

  getHistoryEntry(promptId: string) {
    const h = this.history.get(promptId)
    if (!h) return undefined
    return { prompt: h.prompt.prompt, status: h.status, outputs: h.outputs, error: h.error }
  }

  /** 中断全部（ComfyUI `/interrupt` 语义） */
  interrupt(): void {
    this.cancelledFlag = true
    this.queue = []
    this.broadcast('execution_interrupted', {})
    this.broadcastStatus()
  }

  /** 取消单个任务：排队中 → 直接移除；正在跑 → 置中断标记，由执行器在下一个检查点退出 */
  cancel(promptId: string): CancelTarget {
    const idx = this.queue.findIndex((i) => i.promptId === promptId)
    if (idx >= 0) {
      const [item] = this.queue.splice(idx, 1)
      this.history.set(item.promptId, {
        prompt: item,
        status: 'interrupted',
        finishedAt: Date.now()
      })
      this.broadcast('execution_interrupted', { prompt_id: promptId })
      this.broadcastStatus()
      return 'pending'
    }
    if (this.current && this.current.promptId === promptId) {
      this.cancelledFlag = true
      this.broadcast('execution_interrupted', { prompt_id: promptId })
      return 'running'
    }
    return 'not_found'
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!
        this.current = item
        this.cancelledFlag = false
        this.broadcastStatus()
        const events: ExecEvents = {
          onStatus: (d) => this.broadcast('status', d),
          onExecutionStart: (d) => this.broadcast('execution_start', d),
          onExecuting: (d) => this.broadcast('executing', d),
          onProgress: (d) => this.broadcast('progress', d),
          onExecuted: (d) => {
            this.broadcast('executed', d)
            const entry = this.outputsCache.get(item.promptId) || {}
            entry[d.node] = d.output
            this.outputsCache.set(item.promptId, entry)
          },
          onExecutionError: (d) => {
            this.broadcast('execution_error', d)
            this.history.set(item.promptId, {
              prompt: item,
              status: 'error',
              error: d.exception_message,
              finishedAt: Date.now()
            })
          }
        }
        try {
          await this.executor.execute(item.prompt, item.promptId, events, () => this.cancelledFlag)
          const already = this.history.get(item.promptId)
          if (!already || already.status !== 'error') {
            this.history.set(item.promptId, {
              prompt: item,
              status: this.cancelledFlag ? 'interrupted' : 'completed',
              outputs: this.outputsCache.get(item.promptId) || {},
              finishedAt: Date.now()
            })
          }
        } catch (e) {
          this.history.set(item.promptId, {
            prompt: item,
            status: 'error',
            error: String((e as Error).message || e),
            finishedAt: Date.now()
          })
        }
        this.current = null
        this.broadcastStatus()
        // 任务结束：通知前端（用于「已完成」提示与队列清空）
        this.broadcast('task_done', {
          prompt_id: item.promptId,
          status: this.history.get(item.promptId)?.status ?? 'completed'
        })
      }
    } finally {
      this.running = false
      this.broadcastStatus()
    }
  }
}
