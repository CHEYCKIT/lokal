// Real Electron + miniaudio integration. Linux prerequisite: a running PulseAudio
// null sink named lokal_test. No provider credentials or physical speakers used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { app, BrowserWindow, ipcMain } = require('electron')
const { registerNativeOutput, closeNativeOutput } = require('../electron/audio/output')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-native-output-'))
app.setPath('userData', path.join(temp, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
let window, server, recorder
const timeout = setTimeout(() => { console.error('Native output smoke timed out'); cleanup(1) }, 45000)
function cleanup(code) {
  clearTimeout(timeout)
  closeNativeOutput()
  recorder?.kill()
  server?.close()
  window?.destroy()
  fs.rmSync(temp, { recursive: true, force: true })
  app.exit(code)
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const wav = Buffer.alloc(44 + 48000 * 8 * 4)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28)
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < 48000 * 8; i++) {
  wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 8192), 44 + i * 4)
  wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 660 / 48000) * 8192), 46 + i * 4)
}
fs.writeFileSync(path.join(temp, 'tone.wav'), wav)
app.whenReady().then(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*' }); res.end(wav) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const streamURL = `http://127.0.0.1:${server.address().port}/tone.wav`
  const bridgeURL = pathToFileURL(path.resolve(__dirname, '../src/audio/nativeOutput.js')).href
  fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><script type="module">
    import { NativeAudioBridge } from ${JSON.stringify(bridgeURL)};
    const ctx = new AudioContext({ sampleRate: 48000 });
    const a = new Audio(${JSON.stringify(pathToFileURL(path.join(temp, 'tone.wav')).href)});
    const b = new Audio(${JSON.stringify(streamURL)});
    a.loop = b.loop = true;
    const ga = ctx.createGain(), gb = ctx.createGain(), eq = ctx.createBiquadFilter(), analyser = ctx.createAnalyser();
    eq.type = 'peaking'; eq.frequency.value = 440; eq.gain.value = 0;
    ctx.createMediaElementSource(a).connect(ga); ctx.createMediaElementSource(b).connect(gb);
    ga.connect(eq); gb.connect(eq); eq.connect(analyser); analyser.connect(ctx.destination);
    gb.gain.value = 0;
    const bridge = new NativeAudioBridge(ctx, analyser, window.electron.nativeAudio);
    a.addEventListener('seeking', () => bridge.flush()); a.addEventListener('pause', () => bridge.flush());
    window.fixture = { ctx, a, b, ga, gb, eq, bridge };
  </script>`)
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../electron/preload.js'), contextIsolation: true, nodeIntegration: false,
    webSecurity: false, backgroundThrottling: false,
  } })
  registerNativeOutput(ipcMain, () => window)
  await window.loadFile(path.join(temp, 'index.html'))
  const run = code => window.webContents.executeJavaScript(code)
  for (let i = 0; i < 100 && !await run('!!window.fixture'); i++) await wait(20)
  assert.ok(await run('!!window.fixture'), 'real module and worklet bridge must load')
  const chunks = []
  recorder = spawn('parecord', ['--raw', '--format=float32le', '--rate=48000', '--channels=2', '--device=lokal_test.monitor'])
  recorder.stdout.on('data', chunk => chunks.push(chunk))
  recorder.stderr.on('data', data => process.stderr.write(data))
  recorder.on('error', error => { throw error })
  await wait(500)
  async function measure(code, silent = false, native = true) {
    console.log('Checking:', code)
    const result = await run(code)
    console.log('Route:', JSON.stringify(result))
    await wait(1200) // allow device buffers and monitor latency to settle
    chunks.length = 0
    await wait(500)
    assert.equal(await run('fixture.bridge.status.mode'), native ? 'native' : 'auto', 'route must stay active throughout capture')
    const pcm = Buffer.concat(chunks)
    let sum = 0
    for (let i = 0; i + 4 <= pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2
    const rms = Math.sqrt(sum / (pcm.length / 4))
    assert.ok(pcm.length > 10000, 'PulseAudio must deliver recorded output')
    assert.ok(silent ? rms < .001 : rms > .02, `expected ${silent ? 'silence' : 'audio'}, RMS=${rms}`)
    return { result, rms }
  }
  const float = await measure(`(async () => { await fixture.ctx.resume(); const s = await fixture.bridge.configure({ precision:'float32' }); await fixture.a.play(); return s })()`)
  assert.equal(float.result.precision, 'float32'); assert.equal(float.result.mode, 'native')
  const int = await measure(`fixture.bridge.configure({ precision:'pcm16' })`)
  assert.equal(int.result.precision, 'pcm16'); assert.equal(int.result.mode, 'native')
  const unavailableExclusive = await measure(`fixture.bridge.configure({ precision:'float32', exclusive:true })`)
  assert.equal(unavailableExclusive.result.exclusive, false)
  assert.match(unavailableExclusive.result.warning, /Using shared output/)
  assert.equal(await run('fixture.ctx.sinkId.type'), 'none')
  await measure(`fixture.a.currentTime = 4`)
  await measure(`fixture.a.pause()`, true)
  await measure(`(async () => { fixture.ga.gain.value=0; fixture.gb.gain.value=1; await fixture.b.play() })()`)
  const quiet = await measure(`fixture.gb.gain.value=.25`)
  assert.ok(quiet.rms < int.rms * .4, 'volume must survive native routing')
  await measure(`(async () => { fixture.ga.gain.value=.5; fixture.gb.gain.value=.5; fixture.eq.gain.value=3; await fixture.a.play() })()`)
  const fallback = await measure(`fixture.bridge.configure({ precision:'float32', deviceName:'disconnected fixture device' })`, false, false)
  assert.equal(fallback.result.mode, 'auto'); assert.match(fallback.result.warning, /Using Auto/)
  await measure(`fixture.bridge.configure({ precision:'auto' })`, false, false)
  console.log('Native output smoke passed: local + HTTP decode, float32 + PCM16, seek, pause, gain, EQ/mixing, device fallback and Auto; real captured PulseAudio output.')
  cleanup(0)
}).catch(error => { console.error(error); cleanup(1) })
