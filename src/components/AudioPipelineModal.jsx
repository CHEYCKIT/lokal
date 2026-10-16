import React, { useEffect, useState } from 'react'
import { useTranslation } from '../i18n'
import { usePlayerStore } from '../store/player'
import Modal from './Modal'
import { codecName } from '../quality'
import {
  downloadSourceLabel,
  loadAddonNames,
  streamLabel,
  streamRef,
} from '../onlineTracks'
import { listAudioOutputs, outputLabel } from '../audioOutput'
import { readOutputPreferences } from '../audio/nativeOutput'

const UNKNOWN = '—'

function rateLabel(value) {
  const rate = Number(value)
  return Number.isFinite(rate) && rate > 0 ? `${+(rate / 1000).toFixed(1)} kHz` : UNKNOWN
}

function channelsLabel(value) {
  if (typeof value === 'string' && /stereo/i.test(value)) return 'Stereo'
  if (typeof value === 'string' && /mono/i.test(value)) return 'Mono'
  const count = Number(value)
  if (!Number.isFinite(count) || count < 1) return UNKNOWN
  if (count === 1) return 'Mono'
  if (count === 2) return 'Stereo'
  return `${count} channels`
}

function sourceFormat(track) {
  const codec = codecName(track?.codec)
  if (codec) return codec.toUpperCase()

  const path = String(track?.file_path || '')
  if (!path || path.startsWith('ghost://')) return ''
  const filename = path.replace(/[?#].*$/, '').split(/[\\/]/).pop() || ''
  const ext = filename.match(/\.([^.]+)$/)?.[1]?.toUpperCase()
  if (!ext) return ''
  const formats = {
    AAC: 'AAC', AIF: 'AIFF', AIFF: 'AIFF', ALAC: 'ALAC', FLAC: 'FLAC',
    M4A: 'AAC', MP3: 'MP3', OGG: 'Vorbis', OPUS: 'Opus', WAV: 'WAV',
  }
  return formats[ext] || ''
}

function equalizerIsActive() {
  try {
    const gains = JSON.parse(localStorage.getItem('lokal-eq') || '[]')
    return Array.isArray(gains) && gains.some(gain => Math.abs(Number(gain) || 0) > 0.01)
  } catch {
    return false
  }
}

function precisionLabel(value, t) {
  if (value === 'float32') return t('32-bit float')
  if (value === 'pcm16') return t('16-bit PCM')
  return t('System managed')
}

export default function AudioPipelineModal({ open, onClose, track }) {
  const { t } = useTranslation()
  const crossfade = usePlayerStore(state => state.crossfade)
  const outputDeviceId = usePlayerStore(state => state.outputDeviceId)
  const [status, setStatus] = useState(() => window.__lokalOutputStatus || { mode: 'auto' })
  const [preferences, setPreferences] = useState(readOutputPreferences)
  const [nativeDevices, setNativeDevices] = useState([])
  const [browserDevices, setBrowserDevices] = useState([])
  const [diagnostics, setDiagnostics] = useState(null)
  const [addonNames, setAddonNames] = useState({})

  useEffect(() => {
    if (!open) return undefined
    let alive = true

    const refreshDiagnostics = async () => {
      try {
        const result = await window.electron?.nativeAudio?.diagnostics?.()
        if (alive && result) setDiagnostics(result)
      } catch {}
    }

    const refresh = async () => {
      setStatus(window.__lokalOutputStatus || { mode: 'auto' })
      setPreferences(readOutputPreferences())
      const [native, browser, names] = await Promise.all([
        Promise.resolve().then(() => window.electron?.nativeAudio?.devices?.()).catch(() => null),
        listAudioOutputs().catch(() => []),
        loadAddonNames().catch(() => ({})),
      ])
      if (!alive) return
      setNativeDevices(Array.isArray(native?.devices) ? native.devices : [])
      setBrowserDevices(Array.isArray(browser) ? browser : [])
      setAddonNames(names || {})
      await refreshDiagnostics()
    }

    const onOutputStatus = event => {
      setStatus(event?.detail || window.__lokalOutputStatus || { mode: 'auto' })
      setPreferences(readOutputPreferences())
      refreshDiagnostics()
    }
    const onDeviceChange = () => {
      listAudioOutputs().then(devices => { if (alive) setBrowserDevices(devices || []) }).catch(() => {})
    }

    refresh()
    window.addEventListener('lokal:output-status', onOutputStatus)
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    const poll = window.setInterval(refreshDiagnostics, 1000)
    return () => {
      alive = false
      window.clearInterval(poll)
      window.removeEventListener('lokal:output-status', onOutputStatus)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
    }
  }, [open, track?.id])

  const stream = streamRef(track)
  const format = sourceFormat(track)
  const sourceName = stream
    ? (stream.provider?.startsWith('a-') ? addonNames[stream.provider] || 'Addon' : streamLabel(track))
    : downloadSourceLabel(track?.download_source, addonNames)
      || (track?.file_path && !String(track.file_path).startsWith('ghost://') ? t('Local library') : UNKNOWN)

  const nativeActive = status.mode === 'native'
  const nativeRequested = preferences.precision !== 'auto'
  const contextRate = Number(status.sampleRate) || 0
  const sourceRate = Number(track?.sample_rate) || 0
  const decoderRate = sourceRate
  const decoderChannels = track?.channels ?? track?.channel_count ?? track?.channels_count
  const outputRate = contextRate
  const outputPrecision = nativeActive
    ? precisionLabel(status.precision, t)
    : nativeRequested
      ? `${precisionLabel(preferences.precision, t)} (${t('configured')})`
      : t('System managed')

  const browserDevice = browserDevices.find(device => (device.deviceId || 'default') === outputDeviceId)
    || browserDevices.find(device => device.deviceId === 'default')
  const defaultNativeDevice = nativeDevices.find(device => device.isDefault)
  const outputDevice = (nativeActive && (status.deviceName || diagnostics?.deviceName))
    || (nativeRequested && (preferences.deviceName || defaultNativeDevice?.name))
    || (browserDevice && outputLabel(browserDevice, browserDevices.indexOf(browserDevice)))
    || (nativeRequested ? t('System default') : t('System default'))

  const outputApi = (nativeActive && status.backend)
    || (nativeActive && diagnostics?.backend)
    || (nativeRequested ? t('Native output (inactive)') : window.electron ? t('Chromium / system mixer') : t('Browser audio'))

  const outputChannels = nativeActive ? channelsLabel(status.channels || diagnostics?.channels || 2) : t('System managed')
  const bufferFrames = Number(diagnostics?.frameSize || status.frameSize) || 0
  const queuedBlocks = Number(diagnostics?.queuedBlocks)
  const bytesPerSample = (nativeActive ? status.precision : preferences.precision) === 'float32' ? 4 : 2
  const queuedBytes = nativeActive && bufferFrames > 0 && Number.isFinite(queuedBlocks)
    ? Math.max(0, queuedBlocks) * bufferFrames * 2 * bytesPerSample
    : null
  const buffers = queuedBytes !== null
    ? `~${Math.round(queuedBytes / 1024)} KB queued PCM`
    : nativeActive && bufferFrames > 0
      ? `${bufferFrames} frames/block`
      : t('Not reported')

  const transitionMode = crossfade?.mode
    || (Number(crossfade?.beforeEnd) > 0 ? 'crossfade' : 'off')
  const transition = transitionMode === 'automix'
    ? t('AutoMix')
    : transitionMode === 'crossfade'
      ? t('Crossfade')
      : t('Off')
  const equalizer = equalizerIsActive() ? t('On') : t('Off')

  let resampler = t('Browser / system-managed')
  if (nativeActive) {
    if (sourceRate && contextRate && sourceRate !== contextRate) {
      resampler = `Web Audio: ${rateLabel(sourceRate)} → ${rateLabel(contextRate)}; ${t('native endpoint rate-locked')}`
    } else {
      resampler = t('Web Audio graph; native endpoint rate-locked')
    }
  } else if (sourceRate && contextRate && sourceRate !== contextRate) {
    resampler = `Web Audio: ${rateLabel(sourceRate)} → ${rateLabel(contextRate)}`
  }

  const rows = [
    {
      title: 'Source',
      values: [
        [t('Format'), format || t('Not reported')],
        [t('Sources'), sourceName || t('Not reported')],
      ],
    },
    {
      title: 'Decoder',
      values: [
        [t('Decoder Name'), format || t('Chromium media decoder')],
        [t('I/O Rate'), rateLabel(decoderRate)],
        [t('Channels'), channelsLabel(decoderChannels)],
      ],
    },
    {
      title: 'Resampler',
      values: [[t('Resampler'), resampler]],
    },
    {
      title: 'DSP',
      values: [
        [t('Equalizer'), equalizer],
        [t('Transition'), transition],
      ],
    },
    {
      title: 'Output Device',
      values: [
        [t('Output API'), outputApi],
        [t('Device Name'), outputDevice],
        [t('PCM Format'), outputPrecision],
        [t('Sample Rate'), outputRate ? `${rateLabel(outputRate)}${nativeActive ? '' : ` (${t('AudioContext')})`}` : UNKNOWN],
        [t('Channels'), outputChannels],
        [t('Buffers'), buffers],
      ],
    },
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('Audio Pipeline')} width="max-w-xl">
      <div className="space-y-5">
        {rows.map(section => (
          <section key={section.title}>
            <h3 className="border-b border-border pb-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t(section.title)}
            </h3>
            <div className="mt-3 space-y-2">
              {section.values.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-4 text-sm">
                  <span className="text-muted">{label}</span>
                  <span className="break-words text-right font-medium text-text">{value}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
          {t('Browser/OS output format and hardware buffer size are not exposed. The buffer estimate counts queued native PCM only.')}
        </p>
        {status.warning && (
          <p role="status" className="text-xs text-amber-300">{status.warning}</p>
        )}
      </div>
    </Modal>
  )
}
