#!/usr/bin/env node
// Derive desktop icons from the shared full-bleed CD master.
// Desktop's installed icons, tray, taskbar, Dock, and web icons are circular
// with genuinely transparent corners. The sticker remains an accent overlay.
//
// npm run gen:icons (automatically invoked by dev and build)
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const target = path.join(root, 'public')
const source = path.join(target, 'lokal-cd-source.webp')
const S = 512
const DEFAULT_ACCENT = '#C8FF57'

// Relative sticker bounds are tied to the image master. Keep this mask in
// sync with mobile's tool/gen_lokal_launcher_icons.py.
const stickerRect = { x: 0.703, y: 0.358, width: 0.287, height: 0.270, radius: 0.050 }
const DISC_RADIUS = 0.499

function rectSvg(fill, { x, y, width, height, radius }, size = S) {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 1 1">' +
    '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
    '" rx="' + radius + '" ry="' + radius + '" fill="' + fill + '" /></svg>'
  )
}
function discSvg(size = S) {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 1 1">' +
    '<circle cx="0.5" cy="0.5" r="' + DISC_RADIUS + '" fill="white"/></svg>'
  )
}
function ico(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6 + 16 * count)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  let offset = header.length
  for (let i = 0; i < count; i++) {
    const { size, bytes } = pngs[i]
    const at = 6 + i * 16
    header.writeUInt8(size === 256 ? 0 : size, at)
    header.writeUInt8(size === 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(bytes.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += bytes.length
  }
  return Buffer.concat([header, ...pngs.map(p => p.bytes)])
}

async function main() {
  const full = await sharp(source).resize(S, S).ensureAlpha().png().toBuffer()
  const disc = discSvg()
  const sticker = rectSvg('white', stickerRect)
  const tinted = await sharp(full)
    .composite([{ input: rectSvg(DEFAULT_ACCENT, stickerRect) }]).png().toBuffer()
  const circular = await sharp(tinted)
    .composite([{ input: disc, blend: 'dest-in' }]).png().toBuffer()
  // The runtime sticker mask must obey the same circular boundary. Otherwise
  // changing themes can paint pixels outside the transparent disc.
  const stickerMask = await sharp(sticker)
    .composite([{ input: disc, blend: 'dest-in' }]).png().toBuffer()

  await Promise.all([
    fs.writeFile(path.join(target, 'lokal-icon.png'), circular),
    // Keep the established runtime icon filename for accentAppIcon.js and
    // macOS/Linux packaging, but now it contains the same circular artwork.
    fs.writeFile(path.join(target, 'lokal-icon-rounded.png'), circular),
    fs.writeFile(path.join(target, 'lokal-icon-sticker.png'), stickerMask),
    fs.writeFile(path.join(target, 'icon-512.png'), circular),
    fs.writeFile(path.join(target, 'icon-192.png'), await sharp(circular).resize(192).png().toBuffer()),
  ])

  const pngs = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async size => ({
    size, bytes: await sharp(circular).resize(size).png().toBuffer(),
  })))
  await fs.writeFile(path.join(target, 'lokal-icon.ico'), ico(pngs))
  console.log('[branding] circular CD, transparent corners, sticker mask and ICO updated')
}

if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1 })
module.exports = { main, stickerRect, DISC_RADIUS }
