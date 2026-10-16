const os = require('os')

function getRemoteConnectionInfo() {
  const port = Number(process.env.PORT) || 3421
  const urls = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) {
      if (!info || info.internal || info.family !== 'IPv4' || String(info.address).startsWith('169.254.')) continue
      urls.push(`http://${info.address}:${port}/remote`)
    }
  }
  const token = String(process.env.REMOTE_TOKEN || '').trim()
  // Never send the token to the external QR image provider. The remote page
  // asks for it locally when its first state request is rejected.
  const linkedUrls = [...new Set(urls)]
  const primary = linkedUrls[0] || null
  return {
    sameWifiRequired: true,
    primary,
    urls: linkedUrls,
    qrUrl: primary ? `https://quickchart.io/qr?text=${encodeURIComponent(primary)}&size=256` : null,
    tokenRequired: !!token,
  }
}

let remoteState = {
  connected: false,
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  currentTrack: null,
  updatedAt: 0,
}

let remoteCommandHandler = null

function setRemoteState(state) {
  if (!state || typeof state !== 'object') return
  remoteState = {
    ...remoteState,
    ...state,
    connected: true,
    updatedAt: Date.now(),
  }
}

function getRemoteState() {
  return remoteState
}

function setRemoteCommandHandler(handler) {
  remoteCommandHandler = handler
}

async function sendRemoteCommand(command) {
  if (typeof remoteCommandHandler !== 'function') {
    return { error: 'Remote command handler is not ready' }
  }
  try {
    return await remoteCommandHandler(command)
  } catch (e) {
    return { error: e.message || 'Remote command failed' }
  }
}

module.exports = {
  getRemoteConnectionInfo,
  setRemoteState,
  getRemoteState,
  setRemoteCommandHandler,
  sendRemoteCommand,
}
