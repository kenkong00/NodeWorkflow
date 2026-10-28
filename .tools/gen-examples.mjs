import fs from 'fs'

let linkId = 0
function build(nodes) {
  const links = []
  const byId = new Map()
  for (const n of nodes) byId.set(n.id, n)
  for (const n of nodes) {
    for (const inp of n.inputs) {
      if (!inp.from) continue
      const [srcId, srcSlot] = inp.from
      const l = ++linkId
      const src = byId.get(srcId)
      const type = src.outputTypes[srcSlot]
      links.push([l, srcId, srcSlot, n.id, n.inputs.indexOf(inp), type])
      inp.link = l
      src.outputLinks[srcSlot] = src.outputLinks[srcSlot] || []
      src.outputLinks[srcSlot].push(l)
    }
  }
  return {
    last_node_id: Math.max(...nodes.map((n) => n.id)),
    last_link_id: linkId,
    nodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      pos: n.pos,
      size: n.size,
      flags: {},
      order: i,
      mode: 0,
      inputs: n.inputs.map((inp) => ({ name: inp.name, type: inp.type, link: inp.link ?? null })),
      outputs: n.outputNames.map((nm, k) => ({
        name: nm,
        type: n.outputTypes[k],
        links: n.outputLinks[k] || [],
        slot_index: k
      })),
      properties: {},
      widgets_values: n.wv
    })),
    links,
    groups: [],
    config: {},
    extra: {},
    version: 0.4
  }
}

const N = (id, type, pos, size, inputs, outputNames, outputTypes, wv) => ({
  id,
  type,
  pos,
  size,
  inputs: inputs.map((x) => (Array.isArray(x) ? { name: x[0], type: x[1], from: x[2] } : x)),
  outputNames,
  outputTypes,
  outputLinks: outputTypes.map(() => []),
  wv
})

// ---- 03 图像预览 ----
const ex3 = build([
  N(1, 'LoadImage', [80, 120], [320, 250], [{ name: 'image', type: 'COMBO' }], ['IMAGE', 'MASK'], ['IMAGE', 'MASK'], ['example.png']),
  N(2, 'GetImageSizeNative', [460, 120], [250, 80], [{ name: 'image', type: 'IMAGE', from: [1, 0] }], ['width', 'height'], ['INT', 'INT'], []),
  N(3, 'PreviewImage', [460, 250], [380, 320], [{ name: 'images', type: 'IMAGE', from: [1, 0] }], [], [], []),
  N(4, 'NumberDisplay', [460, 40], [250, 140], [{ name: 'value', type: '*', from: [2, 0] }], [], [], [''])
])
fs.writeFileSync('public/examples/03-图像预览.json', JSON.stringify(ex3, null, 2))

// ---- 04 三链合一 ----
const ex4 = build([
  N(1, 'TextInput', [40, 60], [360, 170], [{ name: 'text', type: 'STRING' }], ['TEXT'], ['STRING'], ['这是一条本机执行的文本。\n点右上角「运行」按钮，文本框会出现在下面的「文本显示」节点里。']),
  N(2, 'TextDisplay', [440, 60], [380, 210], [{ name: 'text', type: 'STRING', from: [1, 0] }], [], [], ['']),
  N(3, 'PrimitiveFloat', [40, 280], [230, 70], [{ name: 'value', type: 'FLOAT' }], ['FLOAT'], ['FLOAT'], [6]),
  N(4, 'PrimitiveFloat', [40, 380], [230, 70], [{ name: 'value', type: 'FLOAT' }], ['FLOAT'], ['FLOAT'], [7]),
  N(5, 'MathOp', [320, 280], [300, 210], [{ name: 'op', type: 'COMBO' }, { name: 'a', type: 'FLOAT', from: [3, 0] }, { name: 'b', type: 'FLOAT', from: [4, 0] }], ['RESULT'], ['FLOAT'], ['add', 0, 0]),
  N(6, 'NumberDisplay', [660, 280], [250, 150], [{ name: 'value', type: '*', from: [5, 0] }], [], [], ['']),
  N(7, 'LoadImage', [40, 490], [320, 260], [{ name: 'image', type: 'COMBO' }], ['IMAGE', 'MASK'], ['IMAGE', 'MASK'], ['example.png']),
  N(8, 'GetImageSizeNative', [400, 490], [250, 80], [{ name: 'image', type: 'IMAGE', from: [7, 0] }], ['width', 'height'], ['INT', 'INT'], []),
  N(9, 'NumberDisplay', [690, 470], [250, 140], [{ name: 'value', type: '*', from: [8, 0] }], [], [], ['']),
  N(10, 'PreviewImage', [960, 470], [380, 320], [{ name: 'images', type: 'IMAGE', from: [7, 0] }], [], [], [])
])
fs.writeFileSync('public/examples/04-三链合一.json', JSON.stringify(ex4, null, 2))
console.log('examples written; links:', ex3.links.length, ex4.links.length)
