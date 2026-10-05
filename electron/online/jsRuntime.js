// A JavaScript runtime for yt-dlp. YouTube hides its stream URLs behind
// challenges written in JavaScript; yt-dlp solves them with deno, node, bun or
// quickjs, and finds only deno on its own. Signed out, it falls back to a
// player client that needs none, but with cookies (signed in to YouTube Music)
// every client it may use needs one: without it no audio format is left, and
// every song "is not available". Lokal already ships a Node: Electron, run
// as Node with ELECTRON_RUN_AS_NODE (the web server runs on Node itself).
// yt-dlp still prefers a deno the user installed.

// yt-dlp before 2025.11 doesn't know the option, and stops on it.
const UNSUPPORTED = /no such option:?\s*--js-runtimes/i
const MIN_NODE = 22 // yt-dlp's minimum for node
let unsupported = false

/** yt-dlp arguments and spawn options giving it this process as a Node runtime. */
function jsRuntime() {
  const major = Number(String(process.versions.node || '').split('.')[0])
  if (unsupported || !(major >= MIN_NODE) || !process.execPath) return { args: [], options: {} }
  return {
    args: ['--js-runtimes', `node:${process.execPath}`],
    options: process.versions.electron ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } } : {},
  }
}

/** An older yt-dlp refused the option: stop passing it. True when that's what `output` says. */
function jsRuntimeRefused(output) {
  if (unsupported || !UNSUPPORTED.test(String(output || ''))) return false
  unsupported = true
  return true
}

module.exports = { jsRuntime, jsRuntimeRefused, _reset: () => { unsupported = false } }
