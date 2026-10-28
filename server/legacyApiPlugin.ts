/**
 * 遗留 API 插件（SQLite 业务数据：工作流模板/ComfyUI配置/LLM提供商/文档库/设置等）
 * 从原 vite.config.ts 内联中间件整体迁出，行为不变。
 */
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

async function createDBMiddleware() {
  const { getDatabase } = await import('./db.js')
  const { WorkflowTemplateRepo } = await import('./repositories/WorkflowTemplateRepo.js')
  const { ComfyUIConfigRepo } = await import('./repositories/ComfyUIConfigRepo.js')
  const { LLMProviderRepo } = await import('./repositories/LLMProviderRepo.js')
  const { TestedModelsRepo } = await import('./repositories/TestedModelsRepo.js')
  const { CanvasWorkflowRepo } = await import('./repositories/CanvasWorkflowRepo.js')
  const { WorkflowFolderRepo } = await import('./repositories/WorkflowFolderRepo.js')
  const { UserSettingsRepo } = await import('./repositories/UserSettingsRepo.js')
  const { controlLibraryRepo } = await import('./repositories/ControlLibraryRepo.js')
  const { stylePresetsRepo } = await import('./repositories/StylePresetsRepo.js')
  const { DocCategoryRepo, DocumentRepo } = await import('./repositories/DocLibraryRepo.js')

  const db = getDatabase()
  const wfTemplateRepo = new WorkflowTemplateRepo(db)
  const comfyUIConfigRepo = new ComfyUIConfigRepo(db)
  const llmProviderRepo = new LLMProviderRepo(db)
  const testedModelsRepo = new TestedModelsRepo(db)
  const canvasWorkflowRepo = new CanvasWorkflowRepo(db)
  const workflowFolderRepo = new WorkflowFolderRepo(db)
  const docCategoryRepo = new DocCategoryRepo(db)
  const documentRepo = new DocumentRepo(db)

  return {
    wfTemplateRepo,
    comfyUIConfigRepo,
    llmProviderRepo,
    testedModelsRepo,
    canvasWorkflowRepo,
    workflowFolderRepo,
    userSettingsRepo: new UserSettingsRepo(db),
    controlLibraryRepo,
    stylePresetsRepo,
    docCategoryRepo,
    documentRepo
  }
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: any) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** 中间件注册（dev 的 configureServer 与 preview 的 configurePreviewServer 共用） */
function attachLegacyMiddleware(server: any): void {
    let repos: any = null

    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url?.split('?')[0] || ''

          if (!url.startsWith('/api/')) {
            return next()
          }

          // ====== ComfyUI 代理（解决跨域）======
          if (url === '/api/comfyui-fetch') {
            const targetUrl = new URL(req.url || '', 'http://localhost').searchParams.get('url')
            if (!targetUrl) {
              return sendJSON(res, { error: '缺少 url 参数' }, 400)
            }

            try {
              const body = req.method === 'POST' ? await parseBody(req) : undefined
              const proxyRes = await fetch(targetUrl, {
                method: req.method,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: body || undefined
              })

              res.statusCode = proxyRes.status
              const contentType = proxyRes.headers.get('content-type') || ''
              if (contentType.includes('application/json')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(await proxyRes.text())
              } else if (contentType.includes('image/')) {
                res.setHeader('Content-Type', contentType)
                const buf = Buffer.from(await proxyRes.arrayBuffer())
                res.end(buf)
              } else {
                res.setHeader('Content-Type', contentType || 'text/plain')
                res.end(await proxyRes.text())
              }
            } catch (err: any) {
              console.error('[ComfyUI Proxy] 请求失败:', targetUrl, err.message)
              return sendJSON(res, { error: err.message || '代理请求失败' }, 502)
            }
            return
          }

          if (!repos) {
            try {
              repos = await createDBMiddleware()
              console.log('\n📡 SQLite API 中间件已启用')
              console.log('   GET/POST /api/workflow-templates     → 工作流模板 (多)')
              console.log('   GET/POST /api/comfyui-configs       → ComfyUI配置 (多)')
              console.log('   GET/POST /api/llm-providers         → LLM提供商 (多)')
              console.log('   GET/PUT     /api/tested-models      → 已测试通过的模型')
              console.log('   GET/POST /api/canvas-workflows     → 画布工作流')
              console.log('   CRUD    /api/workflow-folders     → 工作流文件夹/分类')
              console.log('   CRUD    /api/settings            → 用户偏好设置')
              console.log('   CRUD    /api/control-library     → 基础控件库 (15种预置控件)')
              console.log('   CRUD    /api/style-presets        → 样式配置库 (端点/节点/控件/特效)')
              console.log('   CRUD    /api/doc-categories      → 文档库分类')
              console.log('   CRUD    /api/documents           → 文档库文档')
            } catch (err) {
              console.error('[API] 数据库初始化失败:', err)
              return sendJSON(res, { error: '数据库初始化失败' }, 500)
            }
          }

          // ====== 工作流模板 API ======
          if (url === '/api/workflow-templates' || url.startsWith('/api/workflow-templates/')) {
            const id = url.split('/')[3]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.wfTemplateRepo.findAll())
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.wfTemplateRepo.create(body)
                console.log(`[API] ✅ 工作流模板已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.wfTemplateRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.wfTemplateRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ 工作流模板已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== ComfyUI 配置 API ======
          if (url === '/api/comfyui-configs' || url.startsWith('/api/comfyui-configs/')) {
            const parts = url.split('/').filter(Boolean)
            const id = parts[2]
            const action = parts[3]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.comfyUIConfigRepo.findAll())
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.comfyUIConfigRepo.create(body)
                console.log(`[API] ✅ ComfyUI配置已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id && action !== 'activate') {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.comfyUIConfigRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id && action === 'activate') {
              repos.comfyUIConfigRepo.setActive(id)
              return sendJSON(res, { success: true })
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.comfyUIConfigRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ ComfyUI配置已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 基础控件库 API ======
          if (url === '/api/control-library' || url.startsWith('/api/control-library/')) {
            const id = url.split('/')[3]
            const action = url.split('/')[4]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.controlLibraryRepo.findAll())
            }

            if (req.method === 'GET' && id) {
              const item = repos.controlLibraryRepo.findById(id)
              if (!item) return sendJSON(res, { error: '未找到控件' }, 404)
              return sendJSON(res, item)
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.controlLibraryRepo.create(body)
                console.log(`[API] ✅ 控件已创建: ${created.display_name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'POST' && id && action === 'duplicate') {
              const duplicated = repos.controlLibraryRepo.duplicate(id)
              if (!duplicated) return sendJSON(res, { error: '未找到源控件' }, 404)
              console.log(`[API] 📋 控件已复制: ${duplicated.display_name}`)
              return sendJSON(res, duplicated, 201)
            }

            if (req.method === 'PUT' && id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.controlLibraryRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.controlLibraryRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到或系统内置控件不可删除' }, 404)
              console.log(`[API] 🗑️ 控件已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 样式配置库 API ======
          if (url === '/api/style-presets' || url.startsWith('/api/style-presets/')) {
            const parts = url.split('/').filter(Boolean)
            const id = parts[2]
            const action = parts[3]

            if (url.endsWith('/categories') && req.method === 'GET') {
              return sendJSON(res, repos.stylePresetsRepo.getCategories())
            }

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.stylePresetsRepo.findAll())
            }

            if (req.method === 'GET' && id && !action) {
              const item = repos.stylePresetsRepo.findById(id)
              if (!item) return sendJSON(res, { error: '未找到样式预设' }, 404)
              return sendJSON(res, item)
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.stylePresetsRepo.create(body)
                console.log(`[API] ✅ 样式预设已创建: ${created.preset_name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.stylePresetsRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.stylePresetsRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到或系统内置样式不可删除' }, 404)
              console.log(`[API] 🗑️ 样式预设已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== LLM 提供商 API ======
          if (url === '/api/llm-providers' || url.startsWith('/api/llm-providers/')) {
            const id = url.split('/')[3]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.llmProviderRepo.findAll())
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.llmProviderRepo.create(body)
                console.log(`[API] ✅ LLM提供商已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.llmProviderRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.llmProviderRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ LLM提供商已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 已测试通过的模型 API ======
          if (url === '/api/tested-models') {
            if (req.method === 'GET') {
              return sendJSON(res, repos.testedModelsRepo.findAll())
            }

            if (req.method === 'PUT') {
              try {
                const body = JSON.parse(await parseBody(req))
                repos.testedModelsRepo.replaceAll(body)
                console.log(`[API] ✅ 已测试模型列表已更新`)
                return sendJSON(res, { success: true })
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 画布工作流 API ======
          if (url === '/api/canvas-workflows' || url.startsWith('/api/canvas-workflows/')) {
            const id = url.split('/')[3]
            const action = url.split('/')[4]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.canvasWorkflowRepo.findAll())
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const created = repos.canvasWorkflowRepo.create(body)
                console.log(`[API] ✅ 画布工作流已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id && action !== 'favorite') {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.canvasWorkflowRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id && action === 'favorite') {
              const updated = repos.canvasWorkflowRepo.toggleFavorite(id)
              if (!updated) return sendJSON(res, { error: '未找到' }, 404)
              return sendJSON(res, updated)
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.canvasWorkflowRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ 画布工作流已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 工作流文件夹/分类 API ======
          if (url === '/api/workflow-folders' || url.startsWith('/api/workflow-folders/')) {
            const id = url.split('/')[3]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.workflowFolderRepo.findAll())
            }

            if (req.method === 'POST' && !id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const existing = repos.workflowFolderRepo.findByName(body.name)
                if (existing) return sendJSON(res, { error: '该分类已存在', folder: existing }, 409)
                const created = repos.workflowFolderRepo.create(body)
                console.log(`[API] ✅ 文件夹已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err) {
                return sendJSON(res, { error: '创建失败', details: String(err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const body = JSON.parse(await parseBody(req))
                const updated = repos.workflowFolderRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, updated)
              } catch (err) {
                const msg = String(err)
                if (msg.includes('UNIQUE')) return sendJSON(res, { error: '名称已存在' }, 409)
                return sendJSON(res, { error: '更新失败', details: msg }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.workflowFolderRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ 文件夹已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 文档库分类 API ======
          if (url === '/api/doc-categories' || url.startsWith('/api/doc-categories/')) {
            const id = url.split('/')[3]

            if (req.method === 'GET' && !id) {
              return sendJSON(res, repos.docCategoryRepo.findAll())
            }

            if (req.method === 'GET' && id) {
              const item = repos.docCategoryRepo.findById(id)
              if (!item) return sendJSON(res, { error: '未找到分类' }, 404)
              return sendJSON(res, item)
            }

            if (req.method === 'POST' && !id) {
              try {
                const bodyText = await parseBody(req)
                const body = bodyText ? JSON.parse(bodyText) : {}
                if (!body.name || !String(body.name).trim()) {
                  return sendJSON(res, { error: '分类名称不能为空' }, 400)
                }
                const name = String(body.name).trim()
                const existing = repos.docCategoryRepo.findByName(name)
                if (existing) return sendJSON(res, { error: '该分类已存在', category: existing }, 409)
                const created = repos.docCategoryRepo.create({
                  name,
                  description: body.description || ''
                })
                console.log(`[API] ✅ 文档分类已创建: ${created.name}`)
                return sendJSON(res, created, 201)
              } catch (err: any) {
                return sendJSON(res, { error: '创建失败', details: String(err?.message || err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const bodyText = await parseBody(req)
                const body = bodyText ? JSON.parse(bodyText) : {}
                if (body.name !== undefined) {
                  const name = String(body.name).trim()
                  if (!name) return sendJSON(res, { error: '分类名称不能为空' }, 400)
                  const dup = repos.docCategoryRepo.findByName(name)
                  if (dup && dup.id !== id) return sendJSON(res, { error: '名称已存在' }, 409)
                  body.name = name
                }
                const updated = repos.docCategoryRepo.update(id, body)
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, repos.docCategoryRepo.findById(id))
              } catch (err: any) {
                const msg = String(err?.message || err)
                if (msg.includes('UNIQUE')) return sendJSON(res, { error: '名称已存在' }, 409)
                return sendJSON(res, { error: '更新失败', details: msg }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              repos.documentRepo.deleteByCategory(id)
              const deleted = repos.docCategoryRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ 文档分类已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 文档库文档 API ======
          if (url === '/api/documents' || url.startsWith('/api/documents/')) {
            const id = url.split('/')[3]

            if (req.method === 'GET' && !id) {
              const categoryId = new URL(req.url || '', 'http://localhost').searchParams.get('categoryId')
              if (categoryId) {
                return sendJSON(res, repos.documentRepo.findByCategory(categoryId))
              }
              return sendJSON(res, repos.documentRepo.findAll())
            }

            if (req.method === 'GET' && id) {
              const item = repos.documentRepo.findById(id)
              if (!item) return sendJSON(res, { error: '未找到文档' }, 404)
              return sendJSON(res, item)
            }

            if (req.method === 'POST' && !id) {
              try {
                const bodyText = await parseBody(req)
                const body = bodyText ? JSON.parse(bodyText) : {}
                if (!body.category_id) return sendJSON(res, { error: '请选择分类' }, 400)
                if (!body.title || !String(body.title).trim()) {
                  return sendJSON(res, { error: '标题不能为空' }, 400)
                }
                const created = repos.documentRepo.create({
                  category_id: String(body.category_id),
                  title: String(body.title).trim(),
                  content: body.content ?? ''
                })
                console.log(`[API] ✅ 文档已创建: ${created.title}`)
                return sendJSON(res, created, 201)
              } catch (err: any) {
                return sendJSON(res, { error: '创建失败', details: String(err?.message || err) }, 400)
              }
            }

            if (req.method === 'PUT' && id) {
              try {
                const bodyText = await parseBody(req)
                const body = bodyText ? JSON.parse(bodyText) : {}
                const updated = repos.documentRepo.update(id, {
                  category_id: body.category_id,
                  title: body.title,
                  content: body.content
                })
                if (!updated) return sendJSON(res, { error: '未找到' }, 404)
                return sendJSON(res, repos.documentRepo.findById(id))
              } catch (err: any) {
                return sendJSON(res, { error: '更新失败', details: String(err?.message || err) }, 400)
              }
            }

            if (req.method === 'DELETE' && id) {
              const deleted = repos.documentRepo.delete(id)
              if (!deleted) return sendJSON(res, { error: '未找到' }, 404)
              console.log(`[API] 🗑️ 文档已删除: ${id}`)
              return sendJSON(res, { success: true })
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          // ====== 用户设置 API (主题等偏好) ======
          if (url === '/api/settings' || url.startsWith('/api/settings/')) {
            const settingKey = url.split('/')[3]

            if (req.method === 'GET' && !settingKey) {
              return sendJSON(res, repos.userSettingsRepo.getAll())
            }

            if (req.method === 'GET' && settingKey) {
              const val = repos.userSettingsRepo.get(settingKey)
              if (val !== undefined) {
                return sendJSON(res, { key: settingKey, value: val })
              }
              return sendJSON(res, { key: settingKey, value: null }, 404)
            }

            if (req.method === 'PUT' && settingKey) {
              try {
                const body = JSON.parse(await parseBody(req))
                repos.userSettingsRepo.set(settingKey, String(body.value ?? ''))
                console.log(`[API] ✅ 设置已更新: ${settingKey}`)
                return sendJSON(res, { success: true, key: settingKey })
              } catch (err) {
                return sendJSON(res, { error: '更新失败', details: String(err) }, 400)
              }
            }

            return sendJSON(res, { error: '方法不允许' }, 405)
          }

          next()
    })
}

export function legacyApiPlugin(): Plugin {
  return {
    name: 'api-middleware',
    configureServer(server) { attachLegacyMiddleware(server) },
    configurePreviewServer(server) { attachLegacyMiddleware(server) }
  }
}
