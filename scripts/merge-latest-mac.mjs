// The Apple silicon and Intel Mac builds each write a latest-mac.yml. The
// Intel one is renamed latest-mac-x64.yml on its runner (release/nightly
// workflows); this folds its files into latest-mac.yml so one updater file
// lists both zips. electron-updater picks the file named "arm64" on Apple
// silicon and the others on Intel.
//
//   node scripts/merge-latest-mac.mjs <release folder>
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function filesBlock(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trimEnd() === 'files:')
  if (start < 0) throw new Error('no "files:" list')
  let end = start + 1
  while (end < lines.length && (/^\s/.test(lines[end]) || lines[end].startsWith('-'))) end++
  return { lines, start, end }
}

const versionOf = text => text.match(/^version:\s*(.+)$/m)?.[1]?.trim()

export function mergeLatestMac(armText, x64Text) {
  if (versionOf(armText) !== versionOf(x64Text)) throw new Error(`versions differ: ${versionOf(armText)} / ${versionOf(x64Text)}`)
  const arm = filesBlock(armText)
  const x64 = filesBlock(x64Text)
  const entries = x64.lines.slice(x64.start + 1, x64.end).filter(line => line.trim())
  return [...arm.lines.slice(0, arm.end), ...entries, ...arm.lines.slice(arm.end)].join('\n')
}

export function mergeInFolder(dir) {
  const x64File = path.join(dir, 'latest-mac-x64.yml')
  const armFile = path.join(dir, 'latest-mac.yml')
  if (!fs.existsSync(x64File)) return 'no Intel updater file'
  const x64Text = fs.readFileSync(x64File, 'utf8')
  if (fs.existsSync(armFile)) fs.writeFileSync(armFile, mergeLatestMac(fs.readFileSync(armFile, 'utf8'), x64Text))
  else fs.writeFileSync(armFile, x64Text)
  fs.rmSync(x64File)
  return 'merged'
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node scripts/merge-latest-mac.mjs <release folder>'); process.exit(2) }
  console.log(`latest-mac.yml: ${mergeInFolder(dir)}`)
}
