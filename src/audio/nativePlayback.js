import { streamRef } from '../onlineTracks.js'

export class NativePlaybackController {
  constructor(api, onStatus = () => {}) {
    this.api = api
    this.onStatus = onStatus
    this.offStatus = api.onNativePlaybackStatus(onStatus)
    this.enabled = true
  }

  async sourceFor(track) {
    const ref = streamRef(track)
    if (ref) {
      const source = await this.api.nativePlaybackSource(ref.provider, ref.id)
      if (source?.error) throw new Error(source.error)
      if (source?.kind === 'file') {
        const file = await this.api.nativePlaybackFile(source.path)
        if (file?.error) throw new Error(file.error)
        return { trackId: String(track.id), kind: 'file', value: file.path, headers: {} }
      }
      if (typeof source?.url !== 'string' || !source.url) throw new Error('Online track has no native-playback stream.')
      return { trackId: String(track.id), kind: 'url', value: source.url, headers: source.headers || {} }
    }
    if (!track?.file_path || track.file_path.startsWith('ghost://')) throw new Error('Track has no playable audio source.')
    const source = await this.api.nativePlaybackFile(track.file_path)
    if (source?.error) throw new Error(source.error)
    return { trackId: String(track.id), kind: 'file', value: source.path, headers: {} }
  }

  async load(track, standby = false) {
    const source = await this.sourceFor(track)
    return this.api.nativePlaybackLoad({ ...source, standby })
  }

  play() { return this.api.nativePlaybackPlay() }
  pause() { return this.api.nativePlaybackPause() }
  stop() { return this.api.nativePlaybackStop() }
  seek(seconds) { return this.api.nativePlaybackSeek(seconds) }
  setVolume(value) { return this.api.nativePlaybackSetVolume(value) }
  setRate(value) { return this.api.nativePlaybackSetRate(value) }
  transition(trackId, fadeMs) { return this.api.nativePlaybackTransition(String(trackId), fadeMs) }

  close() {
    this.offStatus?.()
    const close = this.api.nativePlaybackClose
    return (typeof close === 'function' ? close() : this.api.nativePlaybackStop()).catch(() => {})
  }
}
