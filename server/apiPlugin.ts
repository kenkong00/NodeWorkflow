/**
 * ComfyUI 兼容 API 插件（Vite dev/preview 中间件）
 *
 * 路由与 ComfyUI server.py 对齐：
 *   GET  /object_info            节点表（含插件节点，ApiProvider 选项动态填充）
 *   POST /prompt                 提交工作流执行（workflow JSON 或 prompt 均可）
 *   GET  /queue / POST /interrupt
 *   GET  /history /history/:id
 *   POST /upload/image           上传图像到 input/
 *   GET  /view                   读取图像（支持代理到 ComfyUI）
 *   GET  /extensions             插件前端扩展目录列表（+ 静态服务）
 *   GET  /api/workflows          工作流 CRUD（SQLite）
 *   GET/POST/DELETE /api/plugins 插件管理 / GitHub 安装
 *   WS   /ws                     执行事件（与 ComfyUI 事件类型一致）
 */
import type { Plugin, PreviewServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Server as HttpServer } from 'http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'

import { getDatabase } from './db'
import { registry } from './registry'
import { registerNativeNodes } from './nativeNodes'
import { loadPlugins, listPlugins, installPluginFromGit, setPluginEnabled, uninstallPlugin, PLUGINS_DIR } from './plugins'
import { PromptExecutor } from './execution/engine'
import { PromptValidator } from './execution/validate'
import { PromptQueue } from './execution/queue'
import { workflowToPrompt, type WorkflowJSON } from './execution/convert'
import { INPUT_DIR, OUTPUT_DIR, listInputImages } from './nativeNodes/image'
import { LLMProviderRepo } from './repositories/LLMProviderRepo'
import { runAgentTurn, listAgentTools } from './agent/chat'
import { setLLMRepo } from './agent/repoRef'

/**
 * 工作流磁盘目录（ComfyUI 同款：user/default/workflows/*.json）。
 * 与 ComfyUI 一致——保存即写入硬盘 JSON，打开即直接读取该目录里的 JSON 文件。
 */
const __dir = path.dirname(fileURLToPath(import.meta.url))
const WORKFLOWS_DIR = path.resolve(__dir, '../user/workflows')

/** 把任意名称规整成安全的文件名（去掉路径分隔符与非法字符，补 .json） */
function toWorkflowFileName(name: string): string {
  const base = String(name || '')
    .replace(/\.json$/i, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fff ]/g, '_')
    .trim()
  return `${base || '未命名工作流'}.json`
}

/** 规整成安全的目录名（允许中文/字母数字/下划线/短横线/空格） */
function toFolderName(name: string): string {
  return String(name || '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fff ]/g, '_')
    .trim()
}

/**
 * 把「相对路径」解析成目录内的绝对路径。
 * 只接受正向斜杠分隔的相对路径，逐段过滤 . 与 ..，越界一律判非法。
 */
function resolveInWorkflows(rel: string): string | null {
  const parts = String(rel || '')
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
  if (!parts.length) return null
  const p = path.resolve(WORKFLOWS_DIR, ...parts)
  if (p !== WORKFLOWS_DIR && !p.startsWith(WORKFLOWS_DIR + path.sep)) return null
  return p
}

/** 递归扫描目录：返回嵌套的工作流树（文件夹 + 文件） */
interface TreeFolder {
  type: 'folder'
  name: string
  path: string
  folders: TreeFolder[]
  files: Array<{ id: string; name: string; path: string; updated_at: number; nodeCount: number }>
}
interface TreeFile {
  id: string
  name: string
  path: string
  updated_at: number
  nodeCount: number
}

function scanWorkflowTree(rel = ''): TreeFolder {
  const abs = rel ? resolveInWorkflows(rel) || WORKFLOWS_DIR : WORKFLOWS_DIR
  const node: TreeFolder = { type: 'folder', name: rel ? path.basename(abs) : '', path: rel, folders: [], files: [] }
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return node
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      node.folders.push(scanWorkflowTree(childRel))
      continue
    }
    if (!e.name.toLowerCase().endsWith('.json')) continue
    const p = path.join(abs, e.name)
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (!parsed || !Array.isArray(parsed.nodes)) continue // 跳过非工作流格式
      const st = fs.statSync(p)
      const base = e.name.replace(/\.json$/i, '')
      const id = rel ? `${rel}/${base}` : base
      node.files.push({ id, name: base, path: rel, updated_at: st.mtimeMs, nodeCount: parsed.nodes.length })
    } catch {
      /* 跳过无法读取/解析的文件 */
    }
  }
  node.folders.sort((a, b) => a.name.localeCompare(b.name))
  node.files.sort((a, b) => b.updated_at - a.updated_at)
  return node
}

/** 递归展平成列表（旧接口 /api/workflow-files 用，带 folder 字段） */
function flattenTree(node: TreeFolder, out: TreeFile[] = []): TreeFile[] {
  for (const f of node.files) out.push(f)
  for (const c of node.folders) flattenTree(c, out)
  return out
}

let started = false
let queue: PromptQueue
let llmRepo: LLMProviderRepo

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function ensureStarted(): Promise<void> {
  if (started) return
  started = true
  registerNativeNodes()
  await loadPlugins()
  queue = new PromptQueue(new PromptExecutor(registry))
  llmRepo = new LLMProviderRepo(getDatabase())
  setLLMRepo(llmRepo)
  // 工作流表
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS comfy_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      graph_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

/** 读取 ComfyUI 连接配置（comfyui_configs 表中 is_active=1 的记录） */
function getActiveComfyConfig(): { url: string } | null {
  try {
    const row = getDatabase()
      .prepare('SELECT * FROM comfyui_configs WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get() as { url?: string } | undefined
    if (row?.url) return { url: row.url.replace(/\/+$/, '') }
  } catch { /* 表不存在时忽略 */ }
  return null
}

async function handleApi(req: IncomingMessage, res: ServerResponse, rawUrl: string): Promise<boolean> {
  const send = (d: unknown, s = 200) => json(res, d, s)
  const q = new URL(rawUrl, 'http://localhost')
  // 路径判断统一走 pathname（rawUrl 可能带查询串，如 /view?filename=...）
  const url = q.pathname

  // ===== /object_info =====
  if (url === '/object_info') {
    await ensureStarted()
    const info = registry.objectInfo()
    // ApiProvider 下拉动态填充（ComfyUI INPUT_TYPES 动态调用同款行为）
    const providers = llmRepo.findAll().filter((p) => p.enabled)
    const def = info['ApiProvider']
    if (def) {
      ;(def.input!.required!.provider as unknown[])[1] = {
        ...((def.input!.required!.provider as unknown as [string, Record<string, unknown>])[1] || {}),
        options: providers.map((p) => p.name)
      }
    }
    // LoadImage 类节点：下拉选项 = input/ 目录里的真实图片（ComfyUI 同款）
    const images = listInputImages()
    for (const name of ['LoadImage', 'LoadImageMask', 'LoadImageNative', 'LoadImageMaskNative']) {
      const d = info[name]
      const spec = d?.input?.required?.image as unknown as [unknown, Record<string, unknown>] | undefined
      if (spec) {
        spec[0] = images.length ? images : ['example.png']
      }
    }
    send(info)
    return true
  }

  // ===== /prompt =====
  if (url === '/prompt' && req.method === 'POST') {
    await ensureStarted()
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    let prompt = body.prompt
    if (!prompt && body.workflow) {
      prompt = workflowToPrompt(body.workflow as WorkflowJSON, (type) => registry.getDef(type))
    }
    if (!prompt || typeof prompt !== 'object') {
      send({ error: '缺少 prompt 或 workflow' }, 400)
      return true
    }
    // 先校验：把「哪个节点哪根输入不合法」明确返回给前端，而不是静默忽略
    const check = new PromptValidator(registry).validate(prompt as never)
    if (!check.valid) {
      const details = check.error
        ? `${check.error.message}${check.error.details ? '：' + check.error.details : ''}`
        : '工作流校验失败'
      const perNode = Object.entries(check.node_errors).map(
        ([nid, ne]) => `#${nid} ${ne.class_type}: ${ne.errors.map((x) => `${x.message}(${x.details})`).join('; ')}`
      )
      send(
        {
          error: { type: check.error?.type || 'invalid_prompt', message: details, details: perNode.join('\n') },
          node_errors: check.node_errors
        },
        400
      )
      return true
    }
    const item = queue.put(prompt, body.extra_data)
    return send({ prompt_id: item.promptId, number: item.number, node_errors: {} }), true
  }

  // ===== /queue/cancel（本系统扩展：按 prompt_id 取消单个任务）=====
  if (url === '/queue/cancel' && req.method === 'POST') {
    await ensureStarted()
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    const promptId = String(body.prompt_id || '')
    if (!promptId) {
      send({ error: '缺少 prompt_id' }, 400)
      return true
    }
    const result = queue.cancel(promptId)
    return send({ ok: result !== 'not_found', where: result }), true
  }

  // ===== /queue =====
  if (url === '/queue') {
    await ensureStarted()
    return send(queue.getQueueInfo()), true
  }

  // ===== /interrupt =====
  if (url === '/interrupt' && req.method === 'POST') {
    await ensureStarted()
    queue.interrupt()
    send({ ok: true })
      return true
  }

  // ===== /history =====
  if (url === '/history' || url.startsWith('/history/')) {
    await ensureStarted()
    if (url === '/history') return send(queue.getHistory()), true
    const id = url.slice('/history/'.length)
    const entry = queue.getHistoryEntry(id)
    return entry ? send({ [id]: entry }) : send({}), true
  }

  // ===== /upload/image =====
  if (url.startsWith('/upload/image') && req.method === 'POST') {
    await ensureStarted()
    const filename = (req.headers['x-filename'] as string) || `upload_${Date.now()}.png`
    const safeName = path.basename(filename).replace(/[^\w.\-\u4e00-\u9fff]/g, '_')
    const dest = path.join(INPUT_DIR, safeName)
    const contentType = req.headers['content-type'] || ''
    if (contentType.includes('application/json')) {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const base64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '')
      fs.writeFileSync(dest, Buffer.from(base64, 'base64'))
    } else {
      fs.writeFileSync(dest, await readBody(req))
    }
    send({ name: safeName, subfolder: '', type: 'input' })
      return true
  }

  // ===== /view =====
  if (url.startsWith('/view')) {
    await ensureStarted()
    const filename = q.searchParams.get('filename') || ''
    const subfolder = q.searchParams.get('subfolder') || ''
    const type = (q.searchParams.get('type') || 'output') as 'input' | 'output' | 'temp'
    const source = q.searchParams.get('source')
    if (source === 'comfy') {
      const cfg = getActiveComfyConfig()
      if (cfg) {
        try {
          const upstream = await fetch(`${cfg.url}/view?${q.searchParams.toString()}`)
          if (upstream.ok) {
            res.statusCode = 200
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png')
            res.end(Buffer.from(await upstream.arrayBuffer()))
            return true
          }
        } catch { /* 落到本地 */ }
      }
    }
    const base = type === 'input' ? INPUT_DIR : OUTPUT_DIR
    const p = path.join(base, subfolder, path.basename(filename))
    if (!fs.existsSync(p) || !p.startsWith(base)) {
      send({ error: '文件不存在' }, 404)
      return true
    }
    const ext = path.extname(p).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'application/octet-stream'
    res.statusCode = 200
    res.setHeader('Content-Type', mime)
    res.end(fs.readFileSync(p))
    return true
  }

  // ===== /extensions =====
  if (url === '/extensions') {
    await ensureStarted()
    const list: string[] = []
    for (const [name, webRel] of registry.webDirs) {
      list.push(`/extensions/${name}/`)
      // 静态服务插件前端扩展
      void webRel
    }
    send(list)
      return true
  }

  // ===== /api/comfy/test（设置页：单个 ComfyUI 连接独立测试）=====
  if (url === '/api/comfy/test' && req.method === 'POST') {
    await ensureStarted()
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    const raw = String(body.url || '').trim().replace(/\/+$/, '')
    if (!raw) {
      send({ ok: false, error: '请先填写 ComfyUI 地址' })
      return true
    }
    const startedAt = Date.now()
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 5000)
      const r = await fetch(`${raw}/system_stats`, { signal: ac.signal })
      clearTimeout(timer)
      if (!r.ok) {
        send({ ok: false, error: `HTTP ${r.status}`, latency: Date.now() - startedAt })
        return true
      }
      const data = (await r.json()) as { system?: { comfyui_version?: string; os?: string; python_version?: string }; devices?: Array<{ name?: string; vram_total?: number }> }
      send({
        ok: true,
        latency: Date.now() - startedAt,
        version: data?.system?.comfyui_version || '',
        os: data?.system?.os || '',
        python: data?.system?.python_version || '',
        device: data?.devices?.[0]?.name || '',
        vram: data?.devices?.[0]?.vram_total || 0
      })
      return true
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '连接超时（5s）' : (e as Error).message
      send({ ok: false, error: msg, latency: Date.now() - startedAt })
      return true
    }
  }

  // ===== /api/llm/test（设置页：单个 API 服务商独立测试）=====
  if (url === '/api/llm/test' && req.method === 'POST') {
    await ensureStarted()
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    let baseUrl = String(body.base_url || '').trim().replace(/\/+$/, '')
    let apiKey = String(body.api_key || '')
    let model = String(body.model || '')
    if (body.provider_id) {
      const p = llmRepo.findById(String(body.provider_id))
      if (!p) {
        send({ ok: false, error: '找不到该服务商配置' })
        return true
      }
      baseUrl = String(p.base_url || '').replace(/\/+$/, '')
      apiKey = String(p.api_key || '')
      model = model || String(p.default_model || '')
    }
    if (!baseUrl) {
      send({ ok: false, error: '请先填写 Base URL' })
      return true
    }
    const startedAt = Date.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 12000)
    try {
      // 1) 优先 /models（最轻，能验证 key 是否有效）
      let r = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: ac.signal
      }).catch(() => null)
      if (r && r.ok) {
        const data = (await r.json().catch(() => ({}))) as { data?: Array<{ id?: string }> }
        const models = (data.data || []).map((m) => m.id).filter(Boolean) as string[]
        clearTimeout(timer)
        send({ ok: true, latency: Date.now() - startedAt, mode: 'models', models: models.slice(0, 40), modelCount: models.length })
        return true
      }
      // 2) /models 不支持 → 用一次极小 chat 请求验证
      if (!model) {
        clearTimeout(timer)
        send({ ok: false, error: `HTTP ${r ? r.status : '无响应'}，且未填默认模型，无法进一步验证` })
        return true
      }
      r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
        signal: ac.signal
      })
      clearTimeout(timer)
      if (!r.ok) {
        send({ ok: false, error: `HTTP ${r.status}：${(await r.text()).slice(0, 200)}`, latency: Date.now() - startedAt })
        return true
      }
      send({ ok: true, latency: Date.now() - startedAt, mode: 'chat', model })
      return true
    } catch (e) {
      clearTimeout(timer)
      const msg = (e as Error).name === 'AbortError' ? '连接超时（12s）' : (e as Error).message
      send({ ok: false, error: msg, latency: Date.now() - startedAt })
      return true
    }
  }

  // ===== /api/workflows =====
  if (url.startsWith('/api/workflows')) {
    await ensureStarted()
    const db = getDatabase()
    const id = url.split('/').filter(Boolean)[2]
    if (req.method === 'GET' && !id) {
      const rows = db.prepare('SELECT id, name, created_at, updated_at FROM comfy_workflows ORDER BY updated_at DESC').all()
      send(rows)
      return true
    }
    if (req.method === 'GET' && id) {
      const row = db.prepare('SELECT * FROM comfy_workflows WHERE id = ?').get(id)
      return row ? send(row) : send({ error: '未找到' }, 404), true
    }
    if (req.method === 'POST' && !id) {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const now = Date.now()
      const wid = `wf-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      db.prepare('INSERT INTO comfy_workflows (id, name, graph_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        wid,
        String(body.name || '未命名工作流'),
        JSON.stringify(body.graph || body),
        now,
        now
      )
      send({ id: wid, name: body.name || '未命名工作流' }, 201)
      return true
    }
    if (req.method === 'PUT' && id) {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      // 只改名（标签页双击重命名）时不传 graph：不能把图内容写成 undefined
      if (body.graph === undefined && body.name !== undefined) {
        db.prepare('UPDATE comfy_workflows SET name = ?, updated_at = ? WHERE id = ?').run(String(body.name), Date.now(), id)
        send({ ok: true })
        return true
      }
      const graph = body.graph || body
      db.prepare('UPDATE comfy_workflows SET name = COALESCE(?, name), graph_json = ?, updated_at = ? WHERE id = ?').run(
        body.name ?? null,
        JSON.stringify(graph),
        Date.now(),
        id
      )
      send({ ok: true })
      return true
    }
    if (req.method === 'DELETE' && id) {
      db.prepare('DELETE FROM comfy_workflows WHERE id = ?').run(id)
      send({ ok: true })
      return true
    }
    send({ error: '方法不允许' }, 405)
      return true
  }

  // ===== /api/workflow-files（磁盘 JSON 工作流，支持子文件夹）=====
  if (url.startsWith('/api/workflow-files')) {
    await ensureStarted()
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
    const seg = url.split('/').filter(Boolean) // ['api','workflow-files', ...rel]
    // 支持嵌套：test/我的工作流 → 相对路径拼回去
    const relRaw = seg.slice(2).join('/')
    const rel = relRaw ? decodeURIComponent(relRaw).replace(/\.json$/i, '') : ''
    const absOf = (r: string) => (r ? resolveInWorkflows(r) : null)

    // 列表（兼容旧调用）：递归扫描，返回扁平列表，id = 相对路径
    if (req.method === 'GET' && !rel) {
      const items = flattenTree(scanWorkflowTree()).map((f) => ({
        id: f.id,
        name: f.name,
        folder: f.path,
        created_at: f.updated_at,
        updated_at: f.updated_at,
        nodeCount: f.nodeCount
      }))
      send(items)
      return true
    }

    // 读取单个工作流：返回 { name, graph }
    if (req.method === 'GET' && rel) {
      const p = absOf(rel)
      if (!p) return send({ error: '无效名称' }, 400), true
      const file = p.endsWith('.json') ? p : `${p}.json`
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send({ error: '未找到' }, 404), true
      try {
        const graph = JSON.parse(fs.readFileSync(file, 'utf8'))
        send({ name: path.basename(file, '.json'), graph })
      } catch {
        send({ error: '解析失败' }, 500)
      }
      return true
    }

    // 新建 / 覆盖保存：body { name, graph, folder? } → 写入 folder/<name>.json
    if (req.method === 'POST' && !rel) {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const fn = toWorkflowFileName(body.name || '未命名工作流')
      const folderRel = String(body.folder || '').trim()
      const dir = folderRel ? resolveInWorkflows(folderRel) : WORKFLOWS_DIR
      if (!dir) return send({ error: '无效目录' }, 400), true
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, fn)
      fs.writeFileSync(target, JSON.stringify(body.graph ?? body, null, 2))
      const id = folderRel ? `${folderRel}/${fn.replace(/\.json$/i, '')}` : fn.replace(/\.json$/i, '')
      console.log(`[API] ✅ 工作流已保存为文件: ${id}`)
      send({ id, name: fn.replace(/\.json$/i, ''), path: id, folder: folderRel }, 201)
      return true
    }

    // 重命名：body { newName } → 同目录内改名
    if (req.method === 'PUT' && rel) {
      const src = absOf(rel)
      if (!src) return send({ error: '无效名称' }, 400), true
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const newBase = toWorkflowFileName(String(body.newName || ''))
      if (newBase === '未命名工作流.json' && !String(body.newName || '').trim()) {
        return send({ error: '新名称不能为空' }, 400), true
      }
      const srcFile = src.endsWith('.json') ? src : `${src}.json`
      if (!fs.existsSync(srcFile)) return send({ error: '未找到' }, 404), true
      const dstFile = path.join(path.dirname(srcFile), newBase)
      if (dstFile !== srcFile && fs.existsSync(dstFile)) return send({ error: '已存在同名文件' }, 409), true
      fs.renameSync(srcFile, dstFile)
      const dirRel = path.dirname(rel)
      const newRel = dirRel && dirRel !== '.' ? `${dirRel}/${newBase.replace(/\.json$/i, '')}` : newBase.replace(/\.json$/i, '')
      send({ id: newRel, name: newBase.replace(/\.json$/i, '') })
      return true
    }

    // 删除（文件或整个文件夹）
    if (req.method === 'DELETE' && rel) {
      const p = absOf(rel)
      if (!p) return send({ error: '无效名称' }, 400), true
      const target = fs.existsSync(p) ? p : fs.existsSync(`${p}.json`) ? `${p}.json` : null
      if (!target) return send({ ok: false }, 404), true
      fs.rmSync(target, { recursive: true, force: true })
      send({ ok: true })
      return true
    }

    send({ error: '方法不允许' }, 405)
    return true
  }

  // ===== /api/workflow-tree（工作流目录的文件夹树，侧边「打开工作流」用）=====
  if (url === '/api/workflow-tree') {
    await ensureStarted()
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
    send(scanWorkflowTree(''))
    return true
  }

  // ===== /api/workflow-dirs（新建 / 重命名 / 删除磁盘上的分类文件夹）=====
  // 注意：/api/workflow-folders 已被 legacyApiPlugin 占用（SQLite 版），这里改用 /workflow-dirs
  if (url.startsWith('/api/workflow-dirs')) {
    await ensureStarted()
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
    const relRaw = url.split('/').filter(Boolean).slice(2).join('/')
    const rel = relRaw ? decodeURIComponent(relRaw) : ''

    if (req.method === 'POST' && !rel) {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const parentRel = String(body.parent || '').trim()
      const name = toFolderName(String(body.name || ''))
      if (!name) return send({ error: '文件夹名不能为空' }, 400), true
      const dir = parentRel ? resolveInWorkflows(parentRel) : WORKFLOWS_DIR
      if (!dir) return send({ error: '无效父目录' }, 400), true
      const target = path.join(dir, name)
      if (fs.existsSync(target)) return send({ error: '已存在同名文件夹' }, 409), true
      fs.mkdirSync(target, { recursive: true })
      const id = parentRel ? `${parentRel}/${name}` : name
      send({ ok: true, id, name, parent: parentRel }, 201)
      return true
    }

    if (req.method === 'DELETE' && rel) {
      const p = resolveInWorkflows(rel)
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return send({ ok: false }, 404), true
      fs.rmSync(p, { recursive: true, force: true })
      send({ ok: true })
      return true
    }

    // 重命名文件夹
    if (req.method === 'PUT' && rel) {
      const p = resolveInWorkflows(rel)
      if (!p || !fs.existsSync(p)) return send({ error: '未找到' }, 404), true
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const newName = toFolderName(String(body.newName || ''))
      if (!newName) return send({ error: '名称不能为空' }, 400), true
      const dst = path.join(path.dirname(p), newName)
      if (dst !== p && fs.existsSync(dst)) return send({ error: '已存在同名文件夹' }, 409), true
      fs.renameSync(p, dst)
      const dirRel = path.dirname(rel)
      const newRel = dirRel && dirRel !== '.' ? `${dirRel}/${newName}` : newName
      send({ ok: true, id: newRel, name: newName })
      return true
    }

    send({ error: '方法不允许' }, 405)
    return true
  }

  // ===== /api/agent/*（AI 助手：对话 + 工具调用，SSE 流式）=====
  if (url.startsWith('/api/agent/')) {
    await ensureStarted()

    // 可用供应商 + 模型（AI 窗口右上角的供应商切换器）
    if (url === '/api/agent/providers') {
      const list = llmRepo.findAll().filter((p) => p.enabled)
      send(
        list.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.provider_type,
          base_url: p.base_url,
          default_model: p.default_model,
          temperature: p.temperature,
          max_tokens: p.max_tokens
        }))
      )
      return true
    }

    // 拉取某个供应商的模型列表（用于下拉选择）
    if (url === '/api/agent/models') {
      const pid = new URL(req.url || '', 'http://x').searchParams.get('provider_id') || ''
      const p = pid ? llmRepo.findById(pid) : llmRepo.findAll().filter((x) => x.enabled)[0]
      if (!p) return send({ ok: false, error: '没有可用的 API 供应商，请先到「设置」里添加' }, 400), true
      try {
        const r = await fetch(`${String(p.base_url).replace(/\/+$/, '')}/models`, {
          headers: p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {}
        })
        if (!r.ok) return send({ ok: false, error: `HTTP ${r.status}` }, 200), true
        const data = (await r.json()) as { data?: Array<{ id?: string }> }
        send({ ok: true, models: (data.data || []).map((m) => m.id).filter(Boolean) })
      } catch (e) {
        send({ ok: false, error: (e as Error).message })
      }
      return true
    }

    // 工具清单（前端展示「AI 能做什么」用）
    if (url === '/api/agent/tools') {
      send({ tools: listAgentTools() })
      return true
    }

    // 对话（SSE）
    if (url === '/api/agent/chat' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      await runAgentTurn(body, res)
      return true
    }

    // 工具结果回传 → 继续下一轮
    if (url === '/api/agent/tool-result' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      await runAgentTurn({ ...body, __toolResults: true }, res)
      return true
    }

    send({ error: '方法不允许' }, 405)
    return true
  }

  // ===== /api/plugins =====
  if (url.startsWith('/api/plugins')) {
    await ensureStarted()
    const parts = url.split('/').filter(Boolean)
    const action = parts[2]
    if (req.method === 'GET' && !action) {
      return send(listPlugins().map((p) => ({ ...p, webDir: p.webDir ? `/extensions/${p.name}/` : undefined }))), true
    }
    if (req.method === 'POST' && action === 'install') {
      const body = JSON.parse((await readBody(req)).toString('utf8'))
      const r = await installPluginFromGit(String(body.url || ''))
      return send(r, r.ok ? 200 : 400), true
    }
    if (req.method === 'POST' && action === 'reload') {
      await loadPlugins()
      send({ ok: true })
      return true
    }
    const name = parts[3]
    if (req.method === 'POST' && name) {
      const enable = action !== 'disable'
      const ok = await setPluginEnabled(name, enable)
      return send({ ok }, ok ? 200 : 404), true
    }
    if (req.method === 'DELETE' && name) {
      const ok = await uninstallPlugin(name)
      return send({ ok }, ok ? 200 : 404), true
    }
    send({ error: '方法不允许' }, 405)
      return true
  }

  return false
}

/** WebSocket 升级处理 */
function attachWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || ''
    if (!url.startsWith('/ws')) return
    void ensureStarted().then(() => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        queue.addClient(ws as unknown as WebSocket)
        ws.on('close', () => queue.removeClient(ws as unknown as WebSocket))
      })
    })
  })
}

function middleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    // 必须把完整 URL（含查询串）交给 handleApi：/view?filename=... 等依赖 query 参数
    const url = req.url || ''
    const pathname = url.split('?')[0]
    if (!pathname.startsWith('/object_info') && !pathname.startsWith('/prompt') && !pathname.startsWith('/queue') && !pathname.startsWith('/interrupt') &&
        !pathname.startsWith('/history') && !pathname.startsWith('/upload/image') && !pathname.startsWith('/view') && pathname !== '/extensions' &&
        !pathname.startsWith('/api/workflows') && !pathname.startsWith('/api/workflow-files') && !pathname.startsWith('/api/plugins') &&
        !pathname.startsWith('/api/workflow-tree') && !pathname.startsWith('/api/workflow-dirs') && !pathname.startsWith('/api/agent/') &&
        !pathname.startsWith('/api/comfy/') && !pathname.startsWith('/api/llm/')) {
      return next()
    }
    try {
      const handled = await handleApi(req, res, url)
      if (!handled) next()
    } catch (e) {
      console.error('[ComfyAPI] 错误:', e)
      json(res, { error: String((e as Error).message || e) }, 500)
    }
  }
}

/** 插件前端扩展静态目录 */
function extensionStatic() {
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = req.url?.split('?')[0] || ''
    const m = url.match(/^\/extensions\/([\w.-]+)\/(.*)$/)
    if (!m) return next()
    await ensureStarted()
    const [, name, rest] = m
    const webRel = registry.webDirs.get(name)
    if (!webRel) return next()
    const dir = path.join(PLUGINS_DIR, name, webRel)
    const p = path.join(dir, rest)
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return next()
    const ext = path.extname(p).toLowerCase()
    const mime = ext === '.js' || ext === '.mjs' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.html' ? 'text/html' : 'application/octet-stream'
    res.statusCode = 200
    res.setHeader('Content-Type', mime)
    res.end(fs.readFileSync(p))
  }
}

export function comfyApiPlugin(): Plugin {
  return {
    name: 'comfy-api',
    configureServer(server) {
      attachWebSocket(server.httpServer as HttpServer)
      server.middlewares.use(middleware())
      server.middlewares.use(extensionStatic())
      console.log('🧩 ComfyUI 兼容 API 已启用: /object_info /prompt /queue /ws /api/workflows /api/plugins')
    },
    configurePreviewServer(server: PreviewServer) {
      attachWebSocket(server.httpServer as HttpServer)
      server.middlewares.use(middleware())
      server.middlewares.use(extensionStatic())
    }
  }
}
