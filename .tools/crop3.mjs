import sharp from 'sharp'
const src = '.shots/v2-a-nodes.png'
const meta = await sharp(src).metadata()
console.log('meta', meta.width, meta.height)
// 参数：x y w h out scale
const jobs = process.argv.slice(2)
for (const job of jobs) {
  const [x, y, w, h, out, sc] = job.split(',')
  await sharp(src).extract({ left: +x, top: +y, width: +w, height: +h })
    .resize({ width: Math.round(+w * +(sc || 2)), kernel: 'nearest' })
    .png().toFile(`.shots/${out}`)
  console.log('wrote', out)
}
