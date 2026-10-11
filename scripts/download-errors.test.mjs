import test from 'node:test'
import assert from 'node:assert/strict'
import { explainDownloadError } from '../src/downloadErrors.js'

const tidal = details => `No TIDAL download source returned a usable payload | ${details}`

test('an addon\'s long failure says its cause in plain words, keeping the whole message', () => {
  const limited = explainDownloadError(tidal('HI_RES_LOSSLESS API attempt 1: HTTP 429; LOSSLESS mirror attempt 1: fetch failed'))
  assert.equal(limited.summary, 'TIDAL is limiting requests for now.')
  assert.match(limited.detail, /^No TIDAL download source/)
  assert.match(explainDownloadError(tidal('LOSSLESS API attempt 2: PROVIDER_UNAVAILABLE')).summary, /TIDAL is unavailable right now/)
  assert.match(explainDownloadError(tidal('LOSSLESS API attempt 1: VERIFY_REQUIRED')).summary, /verifying again/)
  assert.match(explainDownloadError(tidal('LOSSLESS API attempt 1: RESOLUTION_TIMEOUT')).summary, /didn't answer in time/)
  assert.match(explainDownloadError(tidal('LOSSLESS API attempt 1: track not found')).summary, /Not available on TIDAL/)
})

test('no recognisable cause: the headline, with the details on demand; plain errors stay as they are', () => {
  const odd = explainDownloadError(tidal('LOSSLESS API attempt 1: something odd'))
  assert.equal(odd.summary, 'No TIDAL download source returned a usable payload')
  assert.match(odd.detail, /something odd/)
  assert.deepEqual(explainDownloadError('Disk full'), { summary: 'Disk full', detail: null })
  assert.match(explainDownloadError('Signed-session bootstrap returned HTTP 429').summary, /^The source is limiting requests/)
  assert.deepEqual(explainDownloadError(''), { summary: 'Failed', detail: null })
})
