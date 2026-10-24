// A native Atmos output may own the same WASAPI endpoint used by Chromium.
// Serialize output teardown, and let normal PCM playback wait for the release
// instead of racing with mpv / Windows Media Foundation shutdown.
let releaseChain = Promise.resolve()

export function beginAtmosOutputRelease(stop) {
  const release = releaseChain.catch(() => {}).then(() => stop())
  // A failed stop must not poison later handoffs forever, but it should be
  // visible during debugging. The caller still gets the original promise.
  releaseChain = release.catch(error => {
    console.warn('[atmos-handoff] native output cleanup failed', error)
  })
  return release
}

export function awaitAtmosOutputRelease() {
  return releaseChain
}

/** The normal play button switches from native Atmos even for the same ID. */
export function shouldToggleNormalStream(currentTrack, matchingSource) {
  return !!currentTrack && !currentTrack.atmosNative && !!matchingSource
}
