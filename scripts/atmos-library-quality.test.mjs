import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { atmosProbeCandidate, hasAtmosJocProfile, probeAtmosFile } = require('../electron/quality/atmos')
const backend = require('../electron/quality')
const source = readFileSync(new URL('../src/quality.js', import.meta.url), 'utf8')
  .replace("import { peekSettings } from './api'", 'const peekSettings = () => ({})')
const frontend = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('JOC detection requires actual E-AC-3 codec AND Dolby Atmos profile', () => {
  const joc = [{ codec_name: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos' }]
  assert.equal(hasAtmosJocProfile(joc), true)
  assert.equal(hasAtmosJocProfile([{ codec_name: 'eac3', profile: 'Dolby Digital Plus' }]), false)
  assert.equal(hasAtmosJocProfile([{ codec_name: 'aac', profile: 'Dolby Digital Plus + Dolby Atmos' }]), false)
  assert.equal(hasAtmosJocProfile([{ codec_name: 'eac3', profile: '' }]), false)
})

test('only candidate audio files are probed, and unverified format is never promoted', async () => {
  const get = tracks => ({ stdout: JSON.stringify({ streams: tracks }) })
  const yes = await probeAtmosFile('/music/track.m4a', {
    codec: 'E-AC-3', ffprobe: 'ffprobe',
    runProbe: async (_bin, args) => {
      assert.equal(args.at(-1), '/music/track.m4a')
      return get([{ codec_name: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos' }])
    },
  })
  assert.equal(yes, 1)
  assert.equal(await probeAtmosFile('/music/track.m4a', {
    codec: 'E-AC-3', ffprobe: 'ffprobe',
    runProbe: async () => get([{ codec_name: 'eac3', profile: 'Dolby Digital Plus' }]),
  }), 0)
  assert.equal(await probeAtmosFile('/music/track.m4a', { codec: 'E-AC-3', ffprobe: null }), null)
  assert.equal(await probeAtmosFile('/music/track.mp3', {
    codec: 'MP3', ffprobe: 'ffprobe', runProbe: () => { throw Error('Should not probe MP3') },
  }), null)
  assert.equal(atmosProbeCandidate('/music/track.atmos.m4a', null), true)
})

test('both backend and frontend show actual Atmos rather than bitrate-derived High', () => {
  const verified = { codec: 'E-AC-3', lossless: 0, bitrate: 768, atmos_verified: 1, id: 9, file_path: '/music/song.m4a' }
  const ordinary = { ...verified, atmos_verified: 0 }
  assert.equal(backend.tierOf(verified), 'atmos')
  assert.equal(frontend.tierOf(verified), 'atmos')
  assert.equal(frontend.formatLabel(verified), 'E-AC-3 JOC · Dolby Atmos')
  assert.equal(frontend.canGetLossless(verified), false)
  assert.equal(backend.tierOf(ordinary), 'high')
  assert.equal(frontend.tierOf(ordinary), 'high')
})

test('quality label uses Atmos only for verified files', () => {
  assert.equal(frontend.TIERS.atmos.label, 'Dolby Atmos')
  assert.match(frontend.TIERS.atmos.className, /bg-black/)
  assert.notEqual(frontend.tierOf({ codec: 'E-AC-3', bitrate: 768, lossless: 0 }), 'atmos')
})
