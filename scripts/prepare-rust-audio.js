const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const manifest = path.join(root, 'native', 'audio-engine', 'Cargo.toml')
const targetTriple = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : null
const targetDir = targetTriple ? path.join('target', targetTriple, 'release') : path.join('target', 'release')
const library = process.platform === 'win32' ? 'lokal_audio_engine.dll'
  : process.platform === 'darwin' ? 'liblokal_audio_engine.dylib'
    : 'liblokal_audio_engine.so'
const target = path.join(root, 'native', 'audio-engine', targetDir, library)
const outputDir = path.join(root, 'electron', 'native')
const output = path.join(outputDir, `audio-playback.${process.platform}-${process.arch}.node`)

const args = ['build', '--manifest-path', manifest, '--release']
if (targetTriple) args.push('--target', targetTriple)
const build = spawnSync('cargo', args, { cwd: root, stdio: 'inherit', shell: true })

if (build.error || build.status !== 0) {
  throw new Error('Failed to build Rust audio playback engine' + (build.error ? ': ' + build.error.message : ''))
}
if (!fs.existsSync(target)) throw new Error('Rust audio playback engine was not produced: ' + target)
fs.mkdirSync(outputDir, { recursive: true })
fs.copyFileSync(target, output)
console.log('Prepared ' + output)
