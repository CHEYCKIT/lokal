const SPEAKER_WORDS = /\bspeakers?\b|\bmonitor(?:s)?\b/i
const HEADPHONE_WORDS = /head(?:phone|set)|earbud|airpod|buds|bluetooth/i

export function outputKind(label = '') {
  const text = String(label)
  return HEADPHONE_WORDS.test(text) && !SPEAKER_WORDS.test(text) ? 'headphones' : 'speaker'
}

export function outputLabel(device, index = 0) {
  const label = String(device?.label || '').trim()
  if (label) return label
  if (device?.deviceId === 'default') return 'System default'
  return `Audio output ${index + 1}`
}

export function audioOutputSupported() {
  const context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  return Boolean(
    context?.prototype && typeof context.prototype.setSinkId === 'function'
      || typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function',
  )
}

export async function listAudioOutputs() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(device => device.kind === 'audiooutput')
}
