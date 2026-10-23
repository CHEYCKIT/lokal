// Regenerates build/appx (the MSIX tile and Store logos) from
// public/lokal-icon.png. Run it again after the icon changes:
//   node scripts/generate-appx-assets.cjs
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const root = path.join(__dirname, '..')
const source = path.join(root, 'public', 'lokal-icon.png')
const outDir = path.join(root, 'build', 'appx')

const assets = [
  ['StoreLogo', 50, 50],
  ['Square44x44Logo', 44, 44],
  ['Square150x150Logo', 150, 150],
  ['Wide310x150Logo', 310, 150],
  ['SmallTile', 71, 71],
  ['LargeTile', 310, 310],
]
const scales = [100, 200]
const targetSizes = [16, 24, 32, 48, 256]

async function render(width, height, file) {
  const side = Math.min(width, height)
  const icon = await sharp(source).resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(path.join(outDir, file))
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const [name, width, height] of assets) {
    for (const scale of scales) {
      await render(Math.round(width * scale / 100), Math.round(height * scale / 100), `${name}.scale-${scale}.png`)
    }
  }
  for (const size of targetSizes) {
    await render(size, size, `Square44x44Logo.targetsize-${size}.png`)
    await render(size, size, `Square44x44Logo.targetsize-${size}_altform-unplated.png`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
