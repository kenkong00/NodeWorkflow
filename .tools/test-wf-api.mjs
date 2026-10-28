const BASE = 'http://127.0.0.1:5173'

async function main() {
  const sampleGraph = {
    last_node_id: 2,
    last_link_id: 1,
    nodes: [
      { id: 1, type: 'Note', pos: [100, 100], size: [200, 80], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: { text: 'hello' }, widgets_values: ['hello'] },
      { id: 2, type: 'Note', pos: [400, 100], size: [200, 80], flags: {}, order: 1, mode: 0, inputs: [], outputs: [], properties: { text: 'world' }, widgets_values: ['world'] }
    ],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4
  }

  const log = (...a) => console.log(...a)

  // 1) list (should be empty: 双图.json is ReactFlow format, filtered)
  let r = await fetch(`${BASE}/api/workflow-files`)
  let list = await r.json()
  log('1) list initial:', JSON.stringify(list))

  // 2) POST create
  r = await fetch(`${BASE}/api/workflow-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试工作流A', graph: sampleGraph })
  })
  const created = await r.json()
  log('2) POST ->', r.status, JSON.stringify(created))

  // 3) GET single
  r = await fetch(`${BASE}/api/workflow-files/${encodeURIComponent(created.id)}`)
  const got = await r.json()
  log('3) GET single ->', r.status, 'name=', got.name, 'nodes=', got.graph?.nodes?.length)

  // 4) list after create
  r = await fetch(`${BASE}/api/workflow-files`)
  list = await r.json()
  log('4) list after create:', JSON.stringify(list))

  // 5) rename
  r = await fetch(`${BASE}/api/workflow-files/${encodeURIComponent(created.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName: '测试工作流B' })
  })
  const renamed = await r.json()
  log('5) rename ->', r.status, JSON.stringify(renamed))
  r = await fetch(`${BASE}/api/workflow-files`)
  list = await r.json()
  log('   list after rename:', JSON.stringify(list))

  // 6) delete
  r = await fetch(`${BASE}/api/workflow-files/${encodeURIComponent(renamed.id)}`, { method: 'DELETE' })
  log('6) delete ->', r.status, JSON.stringify(await r.json()))
  r = await fetch(`${BASE}/api/workflow-files`)
  list = await r.json()
  log('   list after delete:', JSON.stringify(list))

  log('\nALL CHECKS DONE')
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
