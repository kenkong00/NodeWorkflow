import sharp from 'sharp'
const src = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-17T07-06-05-408Z-473a7ed2.png'
const crops = [
  ['crop-group.png', 10, 8, 450, 130],
  ['crop-node.png', 30, 55, 440, 170],
  ['crop-k.png', 975, 45, 395, 320],
  ['crop-prompt.png', 500, 10, 380, 400],
  ['crop-loadimg.png', 25, 590, 470, 280],
  ['crop-link.png', 420, 120, 340, 240],
]
for (const [name, left, top, width, height] of crops) {
  await sharp(src).extract({ left, top, width, height }).resize({ width: width * 2, kernel: 'nearest' }).toFile('.shots/' + name)
}
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const px = (x, y) => { const i = (y * info.width + x) * 3; return '#' + [data[i], data[i+1], data[i+2]].map(v => v.toString(16).padStart(2, '0')).join('') }
const spots = {
  'canvas bg (空白)': [900, 600],
  'group fill (Models内空白)': [250, 250],
  'group border 左边': [19, 250],
  'node body (加载CLIP内)': [250, 400],
  'node titlebar': [250, 68],
  'widget 行底': [200, 150],
  'prompt 大框内': [700, 300],
  'k node body': [1150, 350],
}
for (const [k, [x, y]] of Object.entries(spots)) console.log(k.padEnd(28), px(x, y))
