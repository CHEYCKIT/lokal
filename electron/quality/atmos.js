'use strict'

// E-AC-3 alone does not imply Atmos. Only a positive JOC profile in the
// actual file is sufficient to label an indexed download "Dolby Atmos".
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

function atmosProbeCandidate(filePath, codec) {
  const name = String(filePath || '').toLowerCase()
  const reported = String(codec || '').toLowerCase()
  return /(?:e-?ac-?3|ec-?3|dolby digital plus|joc)/i.test(reported) ||
    /\.atmos\.(?:m4a|mp4|ec3|eac3)$/i.test(name) ||
    /\.(?:ec3|eac3)$/i.test(path.extname(name))
}

function hasAtmosJocProfile(streams) {
  return Array.isArray(streams) && streams.some(stream =>
    String(stream?.codec_name || '').toLowerCase() === 'eac3' &&
    /(?:dolby.*atmos|\bjoc\b)/i.test(String(stream?.profile || '')))
}

function findAtmosProbe() {
  try { return require('../ipc/tools').findFfprobe() || null } catch { return null }
}

/** Returns 1 = verified Atmos, 0 = checked and not Atmos, null = not checked. */
async function probeAtmosFile(filePath, { codec, ffprobe, runProbe = run } = {}) {
  if (!atmosProbeCandidate(filePath, codec)) return null
  if (ffprobe === undefined) ffprobe = findAtmosProbe()
  if (!ffprobe) return null
  try {
    const { stdout } = await runProbe(ffprobe,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,profile',
        '-of', 'json', filePath],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 })
    return hasAtmosJocProfile(JSON.parse(stdout)?.streams) ? 1 : 0
  } catch { return null }
}

module.exports = { atmosProbeCandidate, hasAtmosJocProfile, probeAtmosFile }
