import sharp from 'sharp'
const src = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-17T07-06-05-408Z-473a7ed2.png'
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const px = (x, y) => { const i = (y * info.width + x) * 3; return '#' + [data[i], data[i+1], data[i+2]].map(v => v.toString(16).padStart(2, '0')).join('') }
const scanV = (x, y0, y1, tag) => { const out = []; for (let y = y0; y <= y1; y += 6) out.push(y + ':' + px(x, y)); console.log(tag, out.join('  ')) }
const scanH = (y, x0, x1, tag) => { const out = []; for (let x = x0; x <= x1; x += 8) out.push(x + ':' + px(x, y)); console.log(tag, out.join('  ')) }
scanV(250, 20, 200, '竖直扫 x=250 (Models组→UNet节点)')
scanV(1100, 40, 220, '竖直扫 x=1100 (K采样器)')
scanH(20, 10, 200, '水平扫 y=20 (组头)')
console.log('canvas far  ', px(1300, 1050), px(1200, 620), px(470, 300))
