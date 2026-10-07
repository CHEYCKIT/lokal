// Cancel all also stops frontend batches still resolving songs or addon links.
// A new explicit download captures the new generation and can run normally.
let generation = 0

export function downloadBatchCurrent(isCurrent = () => true) {
  const started = generation
  return () => started === generation && isCurrent()
}

export function cancelDownloadBatches() {
  generation++
}
