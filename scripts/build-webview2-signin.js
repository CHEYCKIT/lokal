// Windows: builds the YouTube Music sign-in helper (tools/webview2-signin,
// Microsoft Edge WebView2) into build/webview2-signin, which the installer
// ships as resources/webview2-signin. Needs the .NET SDK (GitHub's Windows
// runners have it). Without it the app still builds: sign-in then uses
// Lokal's own window, as before.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') process.exit(0)

const root = path.resolve(__dirname, '..')
const project = path.join(root, 'tools', 'webview2-signin', 'LokalSignIn.csproj')
const output = path.join(root, 'build', 'webview2-signin')

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
const dotnet = spawnSync('dotnet', ['--version'], { shell: true, encoding: 'utf8' })
if (dotnet.status !== 0) {
  console.warn('The .NET SDK is not installed: skipping the WebView2 sign-in helper (sign-in uses Lokal\'s own window).')
  process.exit(0)
}
const build = spawnSync('dotnet', ['build', `"${project}"`, '-c', 'Release', '-o', `"${output}"`, '-nologo'], { cwd: root, stdio: 'inherit', shell: true })
if (build.status !== 0) throw new Error('Failed to build the WebView2 sign-in helper')
for (const file of fs.readdirSync(output)) if (/\.pdb$/i.test(file)) fs.rmSync(path.join(output, file))
if (!fs.existsSync(path.join(output, 'LokalSignIn.exe'))) throw new Error('The WebView2 sign-in helper was not produced')
console.log('Prepared ' + output)
