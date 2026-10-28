import sharp from 'sharp'
const src = '.shots/v2-b-zoom.png'
const k = 1650 / 1080
const crop = async (name, l, t, w, h, scale = 2) => {
  await sharp(src).extract({ left: Math.round(l * k), top: Math.round(t * k), width: Math.round(w * k), height: Math.round(h * k) })
    .resize({ width: Math.round(w * k * scale), kernel: 'nearest' }).toFile('.shots/' + name)
}
await crop('crop-v2-float.png', 292, 278, 240, 90)
await crop('crop-v2-text.png', 300, 50, 350, 190, 1.6)
