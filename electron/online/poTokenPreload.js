// Preload of the hidden window that proves to YouTube a real browser is
// asking (poToken.js). It runs in the page's own world (no context isolation,
// no Node for the page): BotGuard, YouTube's attestation script, probes
// window and document and runs in this Chromium as it would on youtube.com.
// The page is youtube.com's robots.txt, so its requests go to YouTube from
// YouTube's own origin. Nothing here is reachable from Lokal's own window.

const { BotGuardClient, getChallenge } = require('bgutils-js/botguard')
const { WebPoMinter } = require('bgutils-js/webpo')
const { buildURL, getHeaders } = require('bgutils-js/utils')

// YouTube's BotGuard request key: the same for every client, not a secret.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
let minter = null

window.__lokalAttest = {
  /** Runs the BotGuard challenge; returns how long the attestation lasts (s). */
  async attest() {
    const challenge = await getChallenge({ requestKey: REQUEST_KEY, fetchFunction: (...args) => window.fetch(...args) })
    const interpreter = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
    if (!interpreter) throw new Error('BotGuard sent no interpreter.')
    new window.Function(interpreter)()
    const botguard = await BotGuardClient.create({ globalName: challenge.globalName, globalObject: window, program: challenge.program })
    const webPoSignalOutput = []
    const response = await botguard.snapshot({ webPoSignalOutput })
    const issued = await window.fetch(buildURL('GenerateIT'), { method: 'POST', headers: getHeaders(), body: JSON.stringify([REQUEST_KEY, response]) })
    if (!issued.ok) throw new Error(`YouTube's integrity check answered ${issued.status}.`)
    const [integrityToken, ttl] = await issued.json()
    if (!integrityToken) throw new Error('YouTube issued no integrity token.')
    minter = await WebPoMinter.create({ integrityToken }, webPoSignalOutput)
    return Number(ttl) > 0 ? Number(ttl) : 12 * 60 * 60
  },
  /** A token bound to one video (local arithmetic, no request). */
  async mint(videoId) {
    if (!minter) throw new Error('Not attested yet.')
    return minter.mintAsWebsafeString(String(videoId))
  },
}
